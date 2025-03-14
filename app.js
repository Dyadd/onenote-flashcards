// Enhanced OneNote Flashcards Server with OAuth 2.0 Authorization Code Flow
const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { JSDOM } = require('jsdom');
const session = require('express-session');
const crypto = require('crypto');

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up session management for storing user tokens
app.use(session({
  secret: process.env.SESSION_SECRET || 'onenote-flashcards-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve static files after session middleware
app.use(express.static('public'));

// Microsoft Graph API authentication - OAuth configuration
const msalConfig = {
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID || 'common'}`
  }
};

const msalClient = new ConfidentialClientApplication(msalConfig);
const msGraphScopes = ['offline_access', 'Notes.Read']; // Include offline_access for refresh tokens

// Redirect URI should match what's registered in Microsoft Entra app registration
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/auth/callback`;

// OpenAI API initialization
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Database setup - use environment variable for data directory if available
const DB_PATH = process.env.DATA_DIR ? path.join(process.env.DATA_DIR) : path.join(__dirname, 'db');
const FLASHCARDS_FILE = path.join(DB_PATH, 'flashcards.json');
const PAGE_CACHE_FILE = path.join(DB_PATH, 'page_cache.json');
const SYNC_INFO_FILE = path.join(DB_PATH, 'sync_info.json');

// Ensure DB directory exists
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
  console.log(`Created data directory at ${DB_PATH}`);
}

// Initialize database files if they don't exist
[FLASHCARDS_FILE, PAGE_CACHE_FILE, SYNC_INFO_FILE].forEach(file => {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({}));
    console.log(`Initialized ${file}`);
  }
});

// Data access functions
function loadFlashcards() {
  const data = fs.readFileSync(FLASHCARDS_FILE, 'utf8');
  return JSON.parse(data);
}

function saveFlashcards(flashcards) {
  fs.writeFileSync(FLASHCARDS_FILE, JSON.stringify(flashcards, null, 2));
}

function loadPageCache() {
  const data = fs.readFileSync(PAGE_CACHE_FILE, 'utf8');
  return JSON.parse(data);
}

function savePageCache(cache) {
  fs.writeFileSync(PAGE_CACHE_FILE, JSON.stringify(cache, null, 2));
}

function loadSyncInfo() {
  const data = fs.readFileSync(SYNC_INFO_FILE, 'utf8');
  return JSON.parse(data);
}

function saveSyncInfo(info) {
  fs.writeFileSync(SYNC_INFO_FILE, JSON.stringify(info, null, 2));
}

// Authentication middleware to check if user is logged in
function ensureAuthenticated(req, res, next) {
  if (req.session.accessToken) {
    return next();
  }
  
  // Remember the original URL they were trying to access
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/signin');
}

// Function to get a valid access token
async function getAccessToken(req) {
  // Check if token exists and is not expired
  if (!req.session.accessToken) {
    throw new Error('No access token available. User needs to authenticate.');
  }

  // If we have a refresh token and the access token is expired, refresh it
  if (req.session.tokenExpires && new Date() > new Date(req.session.tokenExpires)) {
    console.log('Access token expired, attempting to refresh...');
    
    if (!req.session.refreshToken) {
      // No refresh token available, redirect to login
      throw new Error('No refresh token available. User needs to reauthenticate.');
    }
    
    try {
      const refreshTokenRequest = {
        refreshToken: req.session.refreshToken,
        scopes: msGraphScopes
      };
      
      const response = await msalClient.acquireTokenByRefreshToken(refreshTokenRequest);
      
      // Update session with new tokens
      req.session.accessToken = response.accessToken;
      req.session.refreshToken = response.refreshToken || req.session.refreshToken;
      req.session.tokenExpires = new Date(Date.now() + (response.expiresIn * 1000));
      
      console.log('Token refreshed successfully');
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error('Failed to refresh access token.');
    }
  }
  
  return req.session.accessToken;
}

// Microsoft Graph API functions
async function callGraphAPI(req, url, options = {}) {
  try {
    const accessToken = await getAccessToken(req);
    
    const response = await axios({
      url: url.startsWith('https://') ? url : `https://graph.microsoft.com/v1.0${url}`,
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options.headers
      },
      data: options.data,
      params: options.params,
      responseType: options.responseType || 'json'
    });
    return response.data;
  } catch (error) {
    console.error(`Error calling Graph API (${url}):`, error.response?.data || error.message);
    throw error;
  }
}

// Enhanced pagination function to handle large datasets
async function getAllGraphResults(req, initialUrl, options = {}) {
  let results = [];
  let nextLink = initialUrl;
  
  // Keep fetching until no more nextLink
  while (nextLink) {
    console.log(`Fetching page of results from: ${nextLink}`);
    const response = await callGraphAPI(req, nextLink, options);
    
    if (response.value && Array.isArray(response.value)) {
      results = results.concat(response.value);
    }
    
    // Check if there are more pages
    nextLink = response['@odata.nextLink'];
  }
  
  return results;
}

async function getOneNoteNotebooks(req) {
  try {
    return await getAllGraphResults(req, '/me/onenote/notebooks');
  } catch (error) {
    console.error('Error getting notebooks:', error);
    throw error;
  }
}

async function getOneNoteSections(req, notebookId) {
  try {
    return await getAllGraphResults(req, `/me/onenote/notebooks/${notebookId}/sections`);
  } catch (error) {
    console.error('Error getting sections:', error);
    throw error;
  }
}

// Enhanced to handle pagination and filtering by last modified date
async function getOneNotePages(req, sectionId, lastSyncTime = null) {
  try {
    let url = `/me/onenote/sections/${sectionId}/pages`;
    let params = {
      // Select only the fields we need to determine if content changed
      '$select': 'id,title,lastModifiedDateTime',
      // Get more items per page (max allowed)
      '$top': 100
    };
    
    // If we have a lastSyncTime, only get pages modified since then
    if (lastSyncTime) {
      params['$filter'] = `lastModifiedDateTime ge ${lastSyncTime}`;
    }
    
    return await getAllGraphResults(req, url, { params });
  } catch (error) {
    console.error('Error getting pages:', error);
    throw error;
  }
}

async function getPageContent(req, pageId) {
  try {
    return await callGraphAPI(req, `/me/onenote/pages/${pageId}/content`, {
      responseType: 'text'
    });
  } catch (error) {
    console.error('Error getting page content:', error);
    throw error;
  }
}

// Enhanced HTML parsing for OneNote content
function extractTextFromOneNoteHtml(html) {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Remove OneNote-specific elements that aren't useful for flashcards
    const elementsToRemove = [
      'style',
      'meta',
      'script',
      // Add other elements to ignore as needed
    ];
    
    elementsToRemove.forEach(tag => {
      const elements = document.querySelectorAll(tag);
      elements.forEach(el => el.remove());
    });
    
    // Extract meaningful content - focus on headings and paragraphs
    const contentElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, li, table, div.content');
    
    let extractedText = '';
    contentElements.forEach(el => {
      // Get text content, preserve basic structure with newlines
      const content = el.textContent.trim();
      if (content) {
        // Add heading markers for structure
        if (el.tagName.startsWith('H')) {
          extractedText += `### ${content}\n\n`;
        } else if (el.tagName === 'LI') {
          extractedText += `- ${content}\n`;
        } else {
          extractedText += `${content}\n\n`;
        }
      }
    });
    
    return extractedText.trim();
  } catch (error) {
    console.error('Error extracting text from HTML:', error);
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

// Enhanced LLM flashcard extraction with improved prompting
async function extractFlashcardsWithLLM(content, pageTitle) {
  try {
    // Extract text content from OneNote HTML
    const textContent = typeof content === 'string' && content.includes('<html') 
      ? extractTextFromOneNoteHtml(content)
      : content;
    
    // Calculate token limit (approximate)
    const estimatedTokens = textContent.split(/\s+/).length;
    const maxContentTokens = 6000; // Safe limit
    
    // Truncate content if too large
    let processableContent = textContent;
    if (estimatedTokens > maxContentTokens) {
      console.log(`Note content too large (est. ${estimatedTokens} tokens), truncating...`);
      // Truncate by words to stay within limits
      processableContent = textContent
        .split(/\s+/)
        .slice(0, maxContentTokens)
        .join(' ');
    }
    
    // Define prompt for Gemini
    const prompt = `
You are a specialized AI that creates high-quality flashcards for medical students.
Create flashcards from the following medical notes on "${pageTitle}".

Each flashcard should have:
1. A clear, focused question about a medical concept. Consider the surrounding context.
2. A concise but complete answer (1-3 sentences)
3. Be relevant for medical exam preparation

Format your response as JSON:
[
  {
    "question": "What is the pathophysiology of type 2 diabetes?",
    "answer": "Type 2 diabetes is characterized by insulin resistance in peripheral tissues and relative insulin deficiency. This results in hyperglycemia due to inadequate glucose uptake in muscle and adipose tissue, combined with increased hepatic glucose production."
  }
]

Here are the notes:
${processableContent}
`;

    // Initialize Gemini model and generate content
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const responseContent = result.response.text();

    let flashcards;
    try {
      // Extract JSON if it's wrapped in backticks or markdown
      const jsonMatch = responseContent.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || 
                        responseContent.match(/(\[[\s\S]*?\])/);
                        
      if (jsonMatch && jsonMatch[1]) {
        flashcards = JSON.parse(jsonMatch[1]);
      } else {
        flashcards = JSON.parse(responseContent);
      }
      
      // Validate flashcard format
      if (!Array.isArray(flashcards)) {
        throw new Error('Invalid flashcards format');
      }
      
      return flashcards;
    } catch (e) {
      console.error('Error parsing LLM response:', e);
      return []; // Return empty array on parse error
    }
  } catch (error) {
    console.error('Error extracting flashcards with LLM:', error);
    return [];
  }
}

// Optimized sync logic for large note collections
async function syncOneNotePage(req, pageId, pageTitle) {
  try {
    // Get current page content
    const content = await getPageContent(req, pageId);
    
    // Check if page has changed
    const pageCache = loadPageCache();
    let hasChanged = true;
    
    if (pageCache[pageId]) {
      // Use a hash or timestamp comparison for efficiency
      const currentModified = new Date(pageCache[pageId].lastModified || 0);
      const newModified = new Date(Date.now());
      hasChanged = currentModified < newModified;
    }
    
    if (hasChanged) {
      console.log(`Processing page "${pageTitle}" (ID: ${pageId})`);
      
      // Extract flashcards with LLM
      console.log(`Generating flashcards for "${pageTitle}"...`);
      const flashcards = await extractFlashcardsWithLLM(content, pageTitle);
      console.log(`Generated ${flashcards.length} flashcards for "${pageTitle}"`);
      
      // Store flashcards - organize by user ID if available
      const userId = req.session.userId || 'default-user';
      const allFlashcards = loadFlashcards();
      
      // Initialize user's flashcards if not exists
      if (!allFlashcards[userId]) {
        allFlashcards[userId] = {};
      }
      
      allFlashcards[userId][pageId] = {
        pageTitle,
        lastUpdated: new Date().toISOString(),
        cards: flashcards
      };
      saveFlashcards(allFlashcards);
      
      // Update page cache - store minimal info
      pageCache[pageId] = {
        lastModified: new Date().toISOString(),
        lastSync: new Date().toISOString()
      };
      savePageCache(pageCache);
      
      return flashcards.length;
    } else {
      console.log(`Page "${pageTitle}" has not changed.`);
      return 0;
    }
  } catch (error) {
    console.error(`Error syncing page ${pageId}:`, error);
    return 0;
  }
}

async function syncOneNoteSection(req, sectionId, forceFull = false) {
  try {
    console.log(`Syncing section ${sectionId}...`);
    
    // Get last sync time for incremental sync
    const syncInfo = loadSyncInfo();
    let lastSyncTime = null;
    
    if (!forceFull && syncInfo[sectionId] && syncInfo[sectionId].lastSyncTime) {
      lastSyncTime = new Date(syncInfo[sectionId].lastSyncTime).toISOString();
      console.log(`Last sync time for section ${sectionId}: ${lastSyncTime}`);
    }
    
    // Get pages modified since last sync or all pages if no previous sync
    const pages = await getOneNotePages(req, sectionId, lastSyncTime);
    console.log(`Found ${pages.length} pages to process in section ${sectionId}`);
    
    // Save current time for future syncs
    syncInfo[sectionId] = {
      lastSyncTime: new Date().toISOString(),
      pages: pages.length
    };
    saveSyncInfo(syncInfo);
    
    // Process found pages
    let totalUpdated = 0;
    // Process in batches to avoid rate limits
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${i/BATCH_SIZE + 1} of ${Math.ceil(pages.length/BATCH_SIZE)}`);
      
      // Process each page in the batch sequentially
      for (const page of batch) {
        const cardsUpdated = await syncOneNotePage(req, page.id, page.title);
        totalUpdated += cardsUpdated;
      }
      
      // Add a small delay between batches to reduce API load
      if (i + BATCH_SIZE < pages.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return totalUpdated;
  } catch (error) {
    console.error(`Error syncing section ${sectionId}:`, error);
    return 0;
  }
}

// Enhanced full sync that can handle large note collections
async function performFullSync(req, notebookId, sectionId) {
  try {
    console.log(`Starting full sync for notebook ${notebookId}, section ${sectionId}`);
    
    // Reset sync info for this section to force full processing
    const syncInfo = loadSyncInfo();
    syncInfo[sectionId] = {
      lastSyncTime: null,
      lastFullSync: new Date().toISOString()
    };
    saveSyncInfo(syncInfo);
    
    return await syncOneNoteSection(req, sectionId, true);
  } catch (error) {
    console.error('Error performing full sync:', error);
    return 0;
  }
}

// ------ AUTHENTICATION ROUTES ------

// Generate authentication URL and redirect user
app.get('/auth/signin', async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.authState = state;
    
    const authCodeUrlParameters = {
      scopes: msGraphScopes,
      redirectUri: REDIRECT_URI,
      state: state
    };
    
    const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParameters);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error during auth redirect:', error);
    res.status(500).send('Error initiating authentication. Please try again.');
  }
});

// Handle the OAuth callback
app.get('/auth/callback', async (req, res) => {
  try {
    // Verify state parameter to prevent CSRF
    //if (req.session.authState !== req.query.state) {
    //  return res.status(400).send('Invalid state parameter. Authentication failed.');
    //}
    
    // Exchange code for token
    const tokenRequest = {
      code: req.query.code,
      scopes: msGraphScopes,
      redirectUri: REDIRECT_URI
    };
    
    const response = await msalClient.acquireTokenByCode(tokenRequest);
    
    // Save tokens in session
    req.session.accessToken = response.accessToken;
    req.session.refreshToken = response.refreshToken;
    req.session.tokenExpires = new Date(Date.now() + (response.expiresIn * 1000));
    
    // Get user information and store in session
    const userInfo = await callGraphAPI(req, '/me');
    req.session.userId = userInfo.id;
    req.session.userEmail = userInfo.mail || userInfo.userPrincipalName;
    req.session.userName = userInfo.displayName;
    
    // Redirect to original destination or home page
    const returnUrl = req.session.returnTo || '/';
    delete req.session.returnTo;
    
    res.redirect(returnUrl);
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// Logout route
app.get('/auth/signout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// User profile information
app.get('/api/me', ensureAuthenticated, async (req, res) => {
  try {
    res.json({
      name: req.session.userName,
      email: req.session.userEmail,
      authenticated: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------ API ROUTES ------

// Main application page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Auth status check
app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: !!req.session.accessToken,
    userName: req.session.userName || null
  });
});

// Get notebooks - protected by auth
app.get('/api/notebooks', ensureAuthenticated, async (req, res) => {
  try {
    const notebooks = await getOneNoteNotebooks(req);
    res.json(notebooks);
  } catch (error) {
    if (error.message.includes('authenticate')) {
      return res.status(401).json({ error: 'Authentication required', redirect: '/auth/signin' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Get sections for a notebook
app.get('/api/notebooks/:notebookId/sections', ensureAuthenticated, async (req, res) => {
  try {
    const sections = await getOneNoteSections(req, req.params.notebookId);
    res.json(sections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger incremental sync for a section
app.post('/api/sync/section/:sectionId', ensureAuthenticated, async (req, res) => {
  try {
    const cardsUpdated = await syncOneNoteSection(req, req.params.sectionId);
    res.json({ success: true, cardsUpdated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger full sync for a section
app.post('/api/sync/full/:notebookId/:sectionId', ensureAuthenticated, async (req, res) => {
  try {
    const cardsUpdated = await performFullSync(
      req, 
      req.params.notebookId,
      req.params.sectionId
    );
    
    res.json({ success: true, cardsUpdated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save last sync info
app.post('/api/sync/save-last', ensureAuthenticated, (req, res) => {
  try {
    const syncConfig = loadSyncInfo();
    syncConfig.lastActiveSync = {
      notebookId: req.body.notebookId,
      sectionId: req.body.sectionId,
      timestamp: new Date().toISOString()
    };
    saveSyncInfo(syncConfig);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all flashcards for current user
app.get('/api/flashcards', ensureAuthenticated, (req, res) => {
  try {
    const allFlashcards = loadFlashcards();
    const userId = req.session.userId || 'default-user';
    
    // Return only this user's flashcards
    const userFlashcards = allFlashcards[userId] || {};
    res.json(userFlashcards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get flashcards for a specific page
app.get('/api/flashcards/page/:pageId', ensureAuthenticated, (req, res) => {
  try {
    const allFlashcards = loadFlashcards();
    const userId = req.session.userId || 'default-user';
    
    // Get this user's flashcards for the specified page
    const userFlashcards = allFlashcards[userId] || {};
    const pageFlashcards = userFlashcards[req.params.pageId] || { cards: [] };
    
    res.json(pageFlashcards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sync status information
app.get('/api/sync/status', ensureAuthenticated, (req, res) => {
  try {
    const syncInfo = loadSyncInfo();
    res.json(syncInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Initialize automatic background sync
  setInterval(async () => {
    try {
      console.log('Running automatic sync...');
      
      // This now requires a user context, so we can't do background syncs
      // without implementing a more complex solution with stored refresh tokens
      console.log('Auto-sync is disabled with OAuth flow. Users need to trigger syncs manually.');
    } catch (error) {
      console.error('Automatic sync error:', error);
    }
  }, process.env.SYNC_INTERVAL_MS || 300000); // Default: 5 minutes
});

// Make sure you add these additional dependencies to your package.json:
// "jsdom": "^22.1.0",
// "express-session": "^1.17.3",
// "crypto": "^1.0.1"