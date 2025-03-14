// Enhanced client-side app.js for OneNote Flashcards with OAuth support
// Optimized for large note collections and better UX with comprehensive logging

// State management
let currentNotebookId = '';
let currentSectionId = '';
let allFlashcards = {};
let currentPageId = '';
let currentCardIndex = 0;
let isSyncing = false;
let syncProgress = { total: 0, processed: 0 };
let isAuthenticated = false;
let userName = '';

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded, initializing application...');
  // Initialize UI elements only after DOM is fully loaded
  initializeUI();
  init();
});

// Initialize UI elements with logging
function initializeUI() {
  console.log('Initializing UI elements...');
  
  // Authentication elements
  window.authStatus = document.getElementById('auth-status');
  window.loginButton = document.getElementById('login-button');
  window.loginButtonMain = document.getElementById('login-button-main');
  window.logoutButton = document.getElementById('logout-button');
  window.userInfo = document.getElementById('user-info');
  
  // Main navigation elements
  window.notebookSelect = document.getElementById('notebook-select');
  window.sectionSelect = document.getElementById('section-select');
  window.syncButton = document.getElementById('sync-button');
  window.fullSyncButton = document.getElementById('full-sync-button');
  window.syncStatus = document.getElementById('sync-status');
  
  // Pages list and flashcard elements
  window.pagesList = document.getElementById('pages-list');
  window.searchInput = document.getElementById('search-input');
  window.currentPageTitle = document.getElementById('current-page-title');
  window.cardCounter = document.getElementById('card-counter');
  window.flashcardElement = document.getElementById('flashcard');
  window.questionElement = document.getElementById('question');
  window.answerElement = document.getElementById('answer');
  
  // Control buttons
  window.prevButton = document.getElementById('prev-button');
  window.nextButton = document.getElementById('next-button');
  window.toggleButton = document.getElementById('toggle-button');
  window.progressBar = document.getElementById('sync-progress');
  
  // Login section and content section
  window.loginSection = document.getElementById('login-section');
  window.contentSection = document.getElementById('content-section');
  
  // Log any missing elements that could cause issues
  const criticalElements = [
    { name: 'loginSection', element: window.loginSection },
    { name: 'contentSection', element: window.contentSection },
    { name: 'notebookSelect', element: window.notebookSelect },
    { name: 'sectionSelect', element: window.sectionSelect },
    { name: 'pagesList', element: window.pagesList }
  ];
  
  criticalElements.forEach(item => {
    if (!item.element) {
      console.error(`Critical UI element not found: ${item.name}`);
    }
  });
  
  console.log('UI elements initialization complete');
}

// Initialize app with detailed logging
async function init() {
  console.log('Initializing application...');
  try {
    // Check authentication status first
    console.log('Checking authentication status...');
    await checkAuthStatus();
    console.log(`Authentication status: ${isAuthenticated ? 'Authenticated' : 'Not authenticated'}`);
    
    // Setup event listeners
    console.log('Setting up event listeners...');
    setupEventListeners();
    
    // If authenticated, load content
    if (isAuthenticated) {
      console.log('User is authenticated, loading user data...');
      await loadUserData();
    } else {
      console.log('User is not authenticated, displaying login screen');
    }
    
    // Check URL parameters for direct flashcard access
    console.log('Checking URL parameters for direct access...');
    checkUrlParams();
    
    console.log('Initialization complete');
  } catch (error) {
    console.error('Initialization error:', error);
    showNotification('Error initializing app. Please refresh the page.', true);
  }
}

// Check if user is authenticated with detailed logging
async function checkAuthStatus() {
  console.log('Making request to /api/auth/status...');
  try {
    const response = await fetch('/api/auth/status');
    console.log('Auth status response received:', response.status);
    
    if (!response.ok) {
      console.error('Auth status check failed with status:', response.status);
      throw new Error(`Auth status check failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Auth status data:', data);
    
    isAuthenticated = data.authenticated;
    userName = data.userName;
    
    console.log(`Auth check result: authenticated=${isAuthenticated}, userName=${userName}`);
    updateAuthUI();
    return data;
  } catch (error) {
    console.error('Error checking auth status:', error);
    isAuthenticated = false;
    updateAuthUI();
    throw error;
  }
}

// Update UI based on authentication status with logging
function updateAuthUI() {
  console.log(`Updating UI based on authentication status: ${isAuthenticated}`);
  
  if (isAuthenticated) {
    // Show authenticated UI
    console.log('Showing authenticated UI');
    if (loginSection) {
      loginSection.style.display = 'none';
      console.log('Hide login section');
    } else {
      console.error('Login section element not found');
    }
    
    if (contentSection) {
      contentSection.style.display = 'block';
      console.log('Show content section');
    } else {
      console.error('Content section element not found');
    }
    
    if (loginButton) loginButton.style.display = 'none';
    if (logoutButton) logoutButton.style.display = 'block';
    if (userInfo) userInfo.textContent = userName || 'User';
    if (authStatus) authStatus.textContent = 'Signed In';
  } else {
    // Show non-authenticated UI
    console.log('Showing non-authenticated UI');
    if (loginSection) {
      loginSection.style.display = 'block';
      console.log('Show login section');
    } else {
      console.error('Login section element not found');
    }
    
    if (contentSection) {
      contentSection.style.display = 'none';
      console.log('Hide content section');
    } else {
      console.error('Content section element not found');
    }
    
    if (loginButton) loginButton.style.display = 'block';
    if (logoutButton) logoutButton.style.display = 'none';
    if (userInfo) userInfo.textContent = '';
    if (authStatus) authStatus.textContent = 'Not Signed In';
  }
  
  console.log('UI update complete');
}

// Load user data (notebooks, flashcards) with detailed logging
async function loadUserData() {
  console.log('Loading user data...');
  try {
    console.log('Loading notebooks...');
    await loadNotebooks();
    
    console.log('Loading flashcards...');
    await loadFlashcards();
    
    // Check for last selected notebook/section
    console.log('Loading last selection...');
    loadLastSelection();
    
    console.log('User data loaded successfully');
  } catch (error) {
    console.error('Error loading user data:', error);
    
    // If unauthorized, redirect to login
    if (error.status === 401) {
      console.log('Authentication required, redirecting to login');
      window.location.href = '/auth/signin';
    } else {
      showNotification('Error loading your data. Please try again.', true);
    }
  }
}

// Helper functions for UI with logging
function showLoading(message) {
  console.log(`Showing loading indicator: ${message}`);
  const loadingElement = document.getElementById('loading-indicator');
  if (loadingElement) {
    loadingElement.textContent = message || 'Loading...';
    loadingElement.style.display = 'block';
  } else {
    console.error('Loading indicator element not found');
  }
}

function hideLoading() {
  console.log('Hiding loading indicator');
  const loadingElement = document.getElementById('loading-indicator');
  if (loadingElement) {
    loadingElement.style.display = 'none';
  } else {
    console.error('Loading indicator element not found');
  }
}

function showNotification(message, isError = false) {
  console.log(`Showing notification: ${message}, isError: ${isError}`);
  const notification = document.getElementById('notification') || createNotificationElement();
  notification.textContent = message;
  notification.className = `notification ${isError ? 'error' : 'success'}`;
  notification.style.display = 'block';
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    notification.style.display = 'none';
  }, 3000);
}

function createNotificationElement() {
  console.log('Creating notification element');
  const notification = document.createElement('div');
  notification.id = 'notification';
  notification.className = 'notification';
  document.body.appendChild(notification);
  return notification;
}

function updateSyncStatus(message) {
  console.log(`Updating sync status: ${message}`);
  if (syncStatus) {
    syncStatus.textContent = message;
  } else {
    console.error('Sync status element not found');
  }
}

function updateButtons(disableAll) {
  console.log(`Updating buttons, disableAll: ${disableAll}`);
  const buttons = document.querySelectorAll('button');
  buttons.forEach(button => {
    if (disableAll) {
      button.setAttribute('data-previous-state', button.disabled ? 'true' : 'false');
      button.disabled = true;
    } else {
      const prevState = button.getAttribute('data-previous-state');
      if (prevState !== null) {
        button.disabled = prevState === 'true';
        button.removeAttribute('data-previous-state');
      }
    }
  });
}

// Initialize auto-advance feature with logging
let autoAdvanceTimer = null;

function setupAutoAdvance() {
  console.log('Setting up auto-advance feature');
  const autoAdvanceCheckbox = document.getElementById('auto-advance');
  if (!autoAdvanceCheckbox) {
    console.error('Auto-advance checkbox not found');
    return;
  }
  
  autoAdvanceCheckbox.addEventListener('change', function() {
    if (this.checked) {
      console.log('Auto-advance enabled');
      startAutoAdvance();
    } else {
      console.log('Auto-advance disabled');
      stopAutoAdvance();
    }
  });
}

function startAutoAdvance() {
  console.log('Starting auto-advance');
  // Stop any existing timer
  stopAutoAdvance();
  
  // Set delay based on user preference (default 7 seconds)
  const delayElement = document.getElementById('auto-advance-delay');
  const delay = parseInt(delayElement?.value || 7) * 1000;
  console.log(`Auto-advance delay: ${delay}ms`);
  
  autoAdvanceTimer = setInterval(() => {
    // If answer is showing, move to next card
    if (!answerElement.classList.contains('hidden')) {
      if (!nextButton.disabled) {
        console.log('Auto-advance: moving to next card');
        nextButton.click();
      } else {
        // Reached the end, stop auto-advance
        console.log('Auto-advance: reached the end, stopping');
        stopAutoAdvance();
        const checkbox = document.getElementById('auto-advance');
        if (checkbox) checkbox.checked = false;
      }
    } else {
      // If answer is hidden, show it
      console.log('Auto-advance: showing answer');
      toggleButton.click();
    }
  }, delay);
}

function stopAutoAdvance() {
  if (autoAdvanceTimer) {
    console.log('Stopping auto-advance timer');
    clearInterval(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}

// Load saved user selections with logging
function loadLastSelection() {
  console.log('Loading last notebook/section selection');
  const savedSelection = localStorage.getItem('lastSelection');
  if (savedSelection) {
    try {
      const { notebookId, sectionId } = JSON.parse(savedSelection);
      console.log(`Found saved selection: notebookId=${notebookId}, sectionId=${sectionId}`);
      
      if (notebookId) {
        if (notebookSelect) {
          console.log(`Setting notebook select to ${notebookId}`);
          notebookSelect.value = notebookId;
          loadSections(notebookId).then(() => {
            if (sectionId) {
              console.log(`Setting section select to ${sectionId}`);
              if (sectionSelect) {
                sectionSelect.value = sectionId;
                currentSectionId = sectionId;
                currentNotebookId = notebookId;
                
                if (syncButton) syncButton.disabled = false;
                if (fullSyncButton) fullSyncButton.disabled = false;
              } else {
                console.error('Section select element not found');
              }
            }
          });
        } else {
          console.error('Notebook select element not found');
        }
      }
    } catch (e) {
      console.error('Error loading last selection:', e);
    }
  } else {
    console.log('No saved selection found');
  }
}

// Save user selections with logging
function saveSelection() {
  if (currentNotebookId && currentSectionId) {
    console.log(`Saving selection: notebookId=${currentNotebookId}, sectionId=${currentSectionId}`);
    localStorage.setItem('lastSelection', JSON.stringify({
      notebookId: currentNotebookId,
      sectionId: currentSectionId
    }));
  } else {
    console.log('Not saving selection - incomplete notebook/section data');
  }
}

// Check URL parameters for direct access with logging
function checkUrlParams() {
  console.log('Checking URL parameters');
  const urlParams = new URLSearchParams(window.location.search);
  const pageId = urlParams.get('page');
  console.log(`URL parameter 'page': ${pageId}`);
  
  if (pageId) {
    console.log(`Page ID found in URL: ${pageId}`);
    
    if (allFlashcards && allFlashcards[pageId]) {
      console.log(`Found flashcards for page ${pageId}, selecting page`);
      selectPage(pageId);
    } else {
      console.log(`No flashcards found for page ${pageId}`);
    }
  } else {
    console.log('No page ID in URL parameters');
  }
}

// Generate shareable URL for a flashcard set with logging
function getShareableUrl(pageId) {
  const baseUrl = window.location.origin + window.location.pathname;
  const url = `${baseUrl}?page=${pageId}`;
  console.log(`Generated shareable URL: ${url}`);
  return url;
}

// Handle error responses from fetch requests with logging
async function handleFetchResponse(response) {
  console.log(`Handling fetch response, status: ${response.status}`);
  
  if (response.status === 401 || response.status === 403) {
    // Authentication issue
    console.log('Authentication required (401/403), redirecting to login');
    window.location.href = '/auth/signin';
    throw { status: response.status, message: 'Authentication required' };
  }
  
  if (!response.ok) {
    console.error(`Error response: ${response.status} ${response.statusText}`);
    let errorData;
    try {
      errorData = await response.json();
      console.error('Error data:', errorData);
    } catch (e) {
      console.error('Could not parse error response as JSON');
      errorData = { error: 'Unknown error' };
    }
    
    throw { 
      status: response.status, 
      message: errorData.error || `Error: ${response.status} ${response.statusText}`
    };
  }
  
  console.log('Response OK, parsing JSON');
  return response.json();
}

// Load notebooks from API with detailed logging
async function loadNotebooks() {
  console.log('Loading notebooks from API');
  try {
    showLoading('Loading notebooks...');
    console.log('Making request to /api/notebooks');
    const response = await fetch('/api/notebooks');
    
    console.log(`Notebooks response status: ${response.status}`);
    // Handle authentication errors
    if (response.status === 401) {
      // Redirect to login page
      console.log('Authentication required (401), redirecting to login');
      window.location.href = '/auth/signin';
      throw { status: 401, message: 'Authentication required' };
    }
    
    if (!response.ok) {
      console.error(`Error loading notebooks: ${response.status} ${response.statusText}`);
      let errorData;
      try {
        errorData = await response.json();
        console.error('Error data:', errorData);
      } catch (e) {
        console.error('Could not parse error response as JSON');
        errorData = { error: 'Failed to fetch notebooks' };
      }
      throw new Error(errorData.error || 'Failed to fetch notebooks');
    }
    
    const notebooks = await response.json();
    console.log(`Received ${notebooks.length} notebooks`);
    
    if (notebookSelect) {
      console.log('Populating notebook select dropdown');
      notebookSelect.innerHTML = '<option value="">Select a notebook</option>';
      notebooks.forEach(notebook => {
          console.log(`Adding notebook: ${notebook.displayName} (${notebook.id})`);
          const option = document.createElement('option');
          option.value = notebook.id;
          option.textContent = notebook.displayName;
          notebookSelect.appendChild(option);
      });
    } else {
      console.error('Notebook select element not found');
    }
    
    hideLoading();
    return notebooks;
  } catch (error) {
    console.error('Error loading notebooks:', error);
    if (error.status !== 401) { // Don't show notification for auth errors
      showNotification('Failed to load notebooks. Please try again.', true);
    }
    hideLoading();
    throw error;
  }
}

// Load sections for selected notebook with detailed logging
async function loadSections(notebookId) {
  console.log(`Loading sections for notebook: ${notebookId}`);
  try {
    if (!notebookId) {
      console.log('No notebook ID provided, skipping section load');
      return;
    }
    
    showLoading('Loading sections...');
    console.log(`Making request to /api/notebooks/${notebookId}/sections`);
    const response = await fetch(`/api/notebooks/${notebookId}/sections`);
    
    console.log(`Sections response status: ${response.status}`);
    if (!response.ok) {
      console.error(`Error loading sections: ${response.status} ${response.statusText}`);
      if (response.status === 401) {
        console.log('Authentication required (401), redirecting to login');
        window.location.href = '/auth/signin';
        throw { status: 401, message: 'Authentication required' };
      }
      throw new Error('Failed to fetch sections');
    }
    
    const sections = await response.json();
    console.log(`Received ${sections.length} sections`);
    
    if (sectionSelect) {
      console.log('Populating section select dropdown');
      sectionSelect.innerHTML = '<option value="">Select a section</option>';
      sections.forEach(section => {
          console.log(`Adding section: ${section.displayName} (${section.id})`);
          const option = document.createElement('option');
          option.value = section.id;
          option.textContent = section.displayName;
          sectionSelect.appendChild(option);
      });
    } else {
      console.error('Section select element not found');
    }
    
    hideLoading();
    return sections;
  } catch (error) {
    console.error('Error loading sections:', error);
    if (error.status !== 401) {
      showNotification('Failed to load sections. Please try again.', true);
    }
    hideLoading();
    throw error;
  }
}

// Sync section flashcards (incremental) with detailed logging
async function syncSection(notebookId, sectionId) {
  console.log(`Syncing section: notebookId=${notebookId}, sectionId=${sectionId}`);
  if (isSyncing) {
    console.log('Sync already in progress, aborting');
    showNotification('Sync already in progress. Please wait.');
    return;
  }
  
  try {
    isSyncing = true;
    updateSyncStatus('Syncing...');
    updateButtons(true);
    
    if (syncButton) syncButton.disabled = true;
    if (fullSyncButton) fullSyncButton.disabled = true;
    
    console.log(`Making request to /api/sync/section/${sectionId}`);
    const response = await fetch(`/api/sync/section/${sectionId}`, {
      method: 'POST'
    });
    
    console.log(`Sync response status: ${response.status}`);
    // Handle response with common error handler
    const result = await handleFetchResponse(response);
    console.log('Sync result:', result);
    
    if (result.success) {
      console.log(`Sync complete, updated ${result.cardsUpdated} flashcards`);
      console.log('Reloading flashcards after sync');
      await loadFlashcards();
      showNotification(`Sync complete! Updated ${result.cardsUpdated} flashcards.`);
      
      // Save last sync info
      console.log('Saving last sync info');
      saveLastSyncInfo(notebookId, sectionId);
    } else {
      console.error('Sync failed:', result);
      showNotification('Sync failed. Please try again.', true);
    }
  } catch (error) {
    console.error('Error syncing section:', error);
    if (error.status !== 401) { // Don't show notification for auth errors
      showNotification('Failed to sync. Please try again.', true);
    }
  } finally {
    console.log('Sync operation complete');
    isSyncing = false;
    updateSyncStatus('');
    updateButtons(false);
    if (syncButton) syncButton.disabled = false;
    if (fullSyncButton) fullSyncButton.disabled = false;
  }
}

// Perform full sync (for large note collections) with detailed logging
async function fullSync(notebookId, sectionId) {
  console.log(`Full sync requested: notebookId=${notebookId}, sectionId=${sectionId}`);
  if (isSyncing) {
    console.log('Sync already in progress, aborting');
    showNotification('Sync already in progress. Please wait.');
    return;
  }
  
  try {
    // Confirm because this can take a while
    console.log('Prompting for confirmation');
    if (!confirm('Full sync may take several minutes for large note collections. Continue?')) {
      console.log('User cancelled full sync');
      return;
    }
    
    isSyncing = true;
    updateSyncStatus('Performing full sync...');
    updateButtons(true);
    
    if (syncButton) syncButton.disabled = true;
    if (fullSyncButton) fullSyncButton.disabled = true;
    
    // Request full sync
    console.log(`Making request to /api/sync/full/${notebookId}/${sectionId}`);
    const response = await fetch(`/api/sync/full/${notebookId}/${sectionId}`, {
      method: 'POST'
    });
    
    console.log(`Full sync response status: ${response.status}`);
    // Handle response with common error handler
    const result = await handleFetchResponse(response);
    console.log('Full sync result:', result);
    
    if (result.success) {
      console.log(`Full sync complete, created ${result.cardsUpdated} flashcards`);
      console.log('Reloading flashcards after full sync');
      await loadFlashcards();
      showNotification(`Full sync complete! Created ${result.cardsUpdated} flashcards.`);
      
      // Save last sync info
      console.log('Saving last sync info');
      saveLastSyncInfo(notebookId, sectionId);
    } else {
      console.error('Full sync failed:', result);
      showNotification('Full sync failed. Please try again.', true);
    }
  } catch (error) {
    console.error('Error performing full sync:', error);
    if (error.status !== 401) {
      showNotification('Failed to perform full sync. Please try again.', true);
    }
  } finally {
    console.log('Full sync operation complete');
    isSyncing = false;
    updateSyncStatus('');
    updateButtons(false);
    if (syncButton) syncButton.disabled = false;
    if (fullSyncButton) fullSyncButton.disabled = false;
  }
}

// Save last sync information with logging
async function saveLastSyncInfo(notebookId, sectionId) {
  console.log(`Saving last sync info: notebookId=${notebookId}, sectionId=${sectionId}`);
  try {
    console.log('Making request to /api/sync/save-last');
    const response = await fetch('/api/sync/save-last', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ notebookId, sectionId })
    });
    
    console.log(`Save sync info response status: ${response.status}`);
    if (!response.ok) {
      console.error(`Error saving sync info: ${response.status} ${response.statusText}`);
    } else {
      console.log('Last sync info saved successfully');
    }
  } catch (error) {
    console.error('Error saving sync info:', error);
  }
}

// Load all flashcards with detailed logging
async function loadFlashcards() {
  console.log('Loading flashcards from API');
  try {
    showLoading('Loading flashcards...');
    console.log('Making request to /api/flashcards');
    const response = await fetch('/api/flashcards');
    
    console.log(`Flashcards response status: ${response.status}`);
    // Handle response with common error handler
    allFlashcards = await handleFetchResponse(response);
    
    const flashcardCount = Object.keys(allFlashcards).length;
    console.log(`Received flashcards for ${flashcardCount} pages`);
    if (flashcardCount > 0) {
      console.log('First few flashcard pages:', Object.keys(allFlashcards).slice(0, 3));
    }
    
    console.log('Rendering pages list');
    renderPagesList();
    hideLoading();
  } catch (error) {
    console.error('Error loading flashcards:', error);
    if (error.status !== 401) { // Don't show notification for auth errors
      showNotification('Failed to load flashcards. Please try again.', true);
    }
    hideLoading();
  }
}

// Filter pages by search term with logging
function filterPages(searchTerm) {
  console.log(`Filtering pages by search term: "${searchTerm}"`);
  if (!searchTerm) {
    console.log('Empty search term, showing all pages');
    renderPagesList();
    return;
  }
  
  searchTerm = searchTerm.toLowerCase();
  
  const allPageIds = Object.keys(allFlashcards);
  console.log(`Filtering ${allPageIds.length} total pages`);
  
  const filteredPageIds = allPageIds.filter(pageId => {
    const pageData = allFlashcards[pageId];
    
    // Check if page title matches
    if (pageData.pageTitle.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Check if any flashcard content matches
    return pageData.cards.some(card => 
      card.question.toLowerCase().includes(searchTerm) || 
      card.answer.toLowerCase().includes(searchTerm)
    );
  });
  
  console.log(`Found ${filteredPageIds.length} pages matching search term`);
  renderPagesList(filteredPageIds);
}

// Render pages list with flashcards with detailed logging
function renderPagesList(specificPageIds) {
    console.log('Rendering pages list');
    if (!pagesList) {
      console.error('Pages list element not found');
      return;
    }
    
    pagesList.innerHTML = '';
    
    // Use provided pageIds or all pages
    const pageIds = specificPageIds || Object.keys(allFlashcards);
    console.log(`Rendering ${pageIds.length} pages`);
    
    if (pageIds.length === 0) {
        console.log('No pages to display');
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        listItem.textContent = specificPageIds 
            ? 'No matching flashcards found.' 
            : 'No flashcards yet. Sync to create them.';
        pagesList.appendChild(listItem);
        return;
    }
    
    // Sort pages by title for better organization
    console.log('Sorting pages by title');
    pageIds.sort((a, b) => {
        const titleA = allFlashcards[a]?.pageTitle || '';
        const titleB = allFlashcards[b]?.pageTitle || '';
        return titleA.localeCompare(titleB);
    });
    
    console.log('Adding page items to list');
    pageIds.forEach(pageId => {
        if (!allFlashcards[pageId]) {
          console.warn(`Page ${pageId} not found in flashcards`);
          return;
        }
        
        const pageData = allFlashcards[pageId];
        const cardCount = pageData.cards.length;
        console.log(`Adding page: ${pageData.pageTitle} (${pageId}) with ${cardCount} cards`);
        
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        
        // Highlight currently selected page
        if (pageId === currentPageId) {
            listItem.classList.add('active');
            console.log(`Highlighting current page: ${pageId}`);
        }
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'page-title';
        titleSpan.textContent = pageData.pageTitle;
        
        const badge = document.createElement('span');
        badge.className = 'badge bg-primary rounded-pill';
        badge.textContent = cardCount;
        
        // Add updated timestamp as tooltip
        if (pageData.lastUpdated) {
            const lastUpdated = new Date(pageData.lastUpdated);
            listItem.title = `Last updated: ${lastUpdated.toLocaleString()}`;
        }
        
        listItem.appendChild(titleSpan);
        listItem.appendChild(badge);
        listItem.addEventListener('click', () => selectPage(pageId));
        
        pagesList.appendChild(listItem);
    });
    
    // Show count of results
    console.log(`Showing count of ${pageIds.length} pages`);
    const resultCountContainer = document.createElement('div');
    resultCountContainer.className = 'text-muted small mt-2';
    resultCountContainer.textContent = `Showing ${pageIds.length} pages`;
    
    // Remove any existing count before adding new one
    const existingCount = pagesList.parentNode.querySelector('.text-muted.small.mt-2');
    if (existingCount) {
        console.log('Removing existing count element');
        existingCount.remove();
    }
    
    pagesList.parentNode.appendChild(resultCountContainer);
    
    // Update pages count badge if it exists
    const pagesCount = document.getElementById('pages-count');
    if (pagesCount) {
        console.log(`Updating pages count badge: ${pageIds.length}`);
        pagesCount.textContent = pageIds.length;
    } else {
        console.error('Pages count badge element not found');
    }
    
    console.log('Finished rendering pages list');
}