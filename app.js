// Server-side app.js - Place in root directory
const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Microsoft Graph API authentication
const msalConfig = {
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`
  }
};

const msalClient = new ConfidentialClientApplication(msalConfig);
const msGraphScopes = ['Notes.Read', 'Notes.ReadWrite'];

// Google Gemini API initialization
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Database setup (simple file-based storage)
const DB_PATH = path.join(__dirname, 'db');
const FLASHCARDS_FILE = path.join(DB_PATH, 'flashcards.json');
const PAGE_CACHE_FILE = path.join(DB_PATH, 'page_cache.json');

// Ensure DB directory exists
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

// Initialize database files if they don't exist
if (!fs.existsSync(FLASHCARDS_FILE)) {
  fs.writeFileSync(FLASHCARDS_FILE, JSON.stringify({}));
}

if (!fs.existsSync(PAGE_CACHE_FILE)) {
  fs.writeFileSync(PAGE_CACHE_FILE, JSON.stringify({}));
}

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

// Microsoft Graph API functions
async function getAccessToken() {
  try {
    const result = await msalClient.acquireTokenByClientCredential({
      scopes: msGraphScopes
    });
    return result.accessToken;
  } catch (error) {
    console.error('Error acquiring token:', error);
    throw error;
  }
}

async function getOneNoteNotebooks(accessToken) {
  try {
    const response = await axios.get('https://graph.microsoft.com/v1.0/me/onenote/notebooks', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data.value;
  } catch (error) {
    console.error('Error getting notebooks:', error);
    throw error;
  }
}

async function getOneNoteSections(accessToken, notebookId) {
  try {
    const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/notebooks/${notebookId}/sections`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data.value;
  } catch (error) {
    console.error('Error getting sections:', error);
    throw error;
  }
}

async function getOneNotePages(accessToken, sectionId) {
  try {
    const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data.value;
  } catch (error) {
    console.error('Error getting pages:', error);
    throw error;
  }
}

async function getPageContent(accessToken, pageId) {
  try {
    const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/pages/${pageId}/content`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      responseType: 'text'
    });
    return response.data;
  } catch (error) {
    console.error('Error getting page content:', error);
    throw error;
  }
}

// LLM flashcard extraction
async function extractFlashcardsWithLLM(content, pageTitle) {
  try {
    // Extract plain text from HTML
    const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
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
${textContent.substring(0, 7000)} // Limiting to 7000 chars for token limits
`;

    // Initialize Gemini model and generate content
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

// Sync logic
async function syncOneNotePage(accessToken, pageId, pageTitle) {
  try {
    // Get current page content
    const content = await getPageContent(accessToken, pageId);
    
    // Check if page has changed
    const pageCache = loadPageCache();
    let hasChanged = true;
    
    if (pageCache[pageId]) {
      // Simple content comparison
      hasChanged = content !== pageCache[pageId].content;
    }
    
    if (hasChanged) {
      console.log(`Page "${pageTitle}" has changed, updating flashcards...`);
      
      // Extract flashcards with LLM
      const flashcards = await extractFlashcardsWithLLM(content, pageTitle);
      
      // Store flashcards
      const allFlashcards = loadFlashcards();
      allFlashcards[pageId] = {
        pageTitle,
        lastUpdated: new Date().toISOString(),
        cards: flashcards
      };
      saveFlashcards(allFlashcards);
      
      // Update page cache
      pageCache[pageId] = {
        content,
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

async function syncOneNoteSection(accessToken, sectionId) {
  try {
    const pages = await getOneNotePages(accessToken, sectionId);
    let totalUpdated = 0;
    
    for (const page of pages) {
      const cardsUpdated = await syncOneNotePage(accessToken, page.id, page.title);
      totalUpdated += cardsUpdated;
    }
    
    return totalUpdated;
  } catch (error) {
    console.error(`Error syncing section ${sectionId}:`, error);
    return 0;
  }
}

// Express routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get notebooks
app.get('/api/notebooks', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const notebooks = await getOneNoteNotebooks(accessToken);
    res.json(notebooks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sections for a notebook
app.get('/api/notebooks/:notebookId/sections', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const sections = await getOneNoteSections(accessToken, req.params.notebookId);
    res.json(sections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger sync for a section
app.post('/api/sync/section/:sectionId', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const cardsUpdated = await syncOneNoteSection(accessToken, req.params.sectionId);
    res.json({ success: true, cardsUpdated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save last sync info
app.post('/api/sync/save-last', (req, res) => {
  try {
    fs.writeFileSync(path.join(DB_PATH, 'last_sync.json'), JSON.stringify(req.body));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all flashcards
app.get('/api/flashcards', (req, res) => {
  try {
    const flashcards = loadFlashcards();
    res.json(flashcards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get flashcards for a specific page
app.get('/api/flashcards/page/:pageId', (req, res) => {
  try {
    const flashcards = loadFlashcards();
    const pageFlashcards = flashcards[req.params.pageId] || { cards: [] };
    res.json(pageFlashcards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Initialize automatic sync
  setInterval(async () => {
    try {
      console.log('Running automatic sync...');
      const accessToken = await getAccessToken();
      
      // For MVP, we only sync the last selected section
      const lastSyncFile = path.join(DB_PATH, 'last_sync.json');
      if (fs.existsSync(lastSyncFile)) {
        const lastSyncInfo = JSON.parse(fs.readFileSync(lastSyncFile, 'utf8'));
        if (lastSyncInfo && lastSyncInfo.sectionId) {
          await syncOneNoteSection(accessToken, lastSyncInfo.sectionId);
        }
      }
    } catch (error) {
      console.error('Automatic sync error:', error);
    }
  }, 300000); // 5 minutes
});