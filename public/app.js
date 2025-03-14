// Enhanced client-side app.js for OneNote Flashcards
// Optimized for large note collections and better UX

// State management
let currentNotebookId = '';
let currentSectionId = '';
let allFlashcards = {};
let currentPageId = '';
let currentCardIndex = 0;
let isSyncing = false;
let syncProgress = { total: 0, processed: 0 };

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI elements only after DOM is fully loaded
  initializeUI();
  init();
});

// Initialize UI elements
function initializeUI() {
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
}

// Initialize app
async function init() {
  try {
    await loadNotebooks();
    await loadFlashcards();
    setupEventListeners();
    
    // Check URL parameters for direct flashcard access
    checkUrlParams();
    
    // Check for last selected notebook/section
    loadLastSelection();
  } catch (error) {
    console.error('Initialization error:', error);
    showNotification('Error initializing app. Please refresh the page.');
  }
}

// Helper functions for UI
function showLoading(message) {
  const loadingElement = document.getElementById('loading-indicator');
  if (loadingElement) {
    loadingElement.textContent = message || 'Loading...';
    loadingElement.style.display = 'block';
  }
}

function hideLoading() {
  const loadingElement = document.getElementById('loading-indicator');
  if (loadingElement) {
    loadingElement.style.display = 'none';
  }
}

function showNotification(message, isError = false) {
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
  const notification = document.createElement('div');
  notification.id = 'notification';
  notification.className = 'notification';
  document.body.appendChild(notification);
  return notification;
}

function updateSyncStatus(message) {
  if (syncStatus) {
    syncStatus.textContent = message;
  }
}

function updateButtons(disableAll) {
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

// Initialize auto-advance feature
let autoAdvanceTimer = null;

function setupAutoAdvance() {
  const autoAdvanceCheckbox = document.getElementById('auto-advance');
  if (!autoAdvanceCheckbox) return;
  
  autoAdvanceCheckbox.addEventListener('change', function() {
    if (this.checked) {
      startAutoAdvance();
    } else {
      stopAutoAdvance();
    }
  });
}

function startAutoAdvance() {
  // Stop any existing timer
  stopAutoAdvance();
  
  // Set delay based on user preference (default 7 seconds)
  const delay = parseInt(document.getElementById('auto-advance-delay')?.value || 7) * 1000;
  
  autoAdvanceTimer = setInterval(() => {
    // If answer is showing, move to next card
    if (!answerElement.classList.contains('hidden')) {
      if (!nextButton.disabled) {
        nextButton.click();
      } else {
        // Reached the end, stop auto-advance
        stopAutoAdvance();
        document.getElementById('auto-advance').checked = false;
      }
    } else {
      // If answer is hidden, show it
      toggleButton.click();
    }
  }, delay);
}

function stopAutoAdvance() {
  if (autoAdvanceTimer) {
    clearInterval(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}

// Load saved user selections
function loadLastSelection() {
  const savedSelection = localStorage.getItem('lastSelection');
  if (savedSelection) {
    try {
      const { notebookId, sectionId } = JSON.parse(savedSelection);
      if (notebookId) {
        notebookSelect.value = notebookId;
        loadSections(notebookId).then(() => {
          if (sectionId) {
            sectionSelect.value = sectionId;
            currentSectionId = sectionId;
            currentNotebookId = notebookId;
            syncButton.disabled = false;
            fullSyncButton.disabled = false;
          }
        });
      }
    } catch (e) {
      console.error('Error loading last selection:', e);
    }
  }
}

// Save user selections
function saveSelection() {
  if (currentNotebookId && currentSectionId) {
    localStorage.setItem('lastSelection', JSON.stringify({
      notebookId: currentNotebookId,
      sectionId: currentSectionId
    }));
  }
}

// Check URL parameters for direct access
function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const pageId = urlParams.get('page');
  if (pageId && allFlashcards[pageId]) {
    selectPage(pageId);
  }
}

// Generate shareable URL for a flashcard set
function getShareableUrl(pageId) {
  const baseUrl = window.location.origin + window.location.pathname;
  return `${baseUrl}?page=${pageId}`;
}

// Load notebooks from API
async function loadNotebooks() {
  try {
    showLoading('Loading notebooks...');
    const response = await fetch('/api/notebooks');
    if (!response.ok) throw new Error('Failed to fetch notebooks');
    
    const notebooks = await response.json();
    
    notebookSelect.innerHTML = '<option value="">Select a notebook</option>';
    notebooks.forEach(notebook => {
        const option = document.createElement('option');
        option.value = notebook.id;
        option.textContent = notebook.displayName;
        notebookSelect.appendChild(option);
    });
    
    hideLoading();
    return notebooks;
  } catch (error) {
    console.error('Error loading notebooks:', error);
    showNotification('Failed to load notebooks. Please try again.');
    hideLoading();
    throw error;
  }
}

// Load sections for selected notebook
async function loadSections(notebookId) {
  try {
    if (!notebookId) return;
    
    showLoading('Loading sections...');
    const response = await fetch(`/api/notebooks/${notebookId}/sections`);
    if (!response.ok) throw new Error('Failed to fetch sections');
    
    const sections = await response.json();
    
    sectionSelect.innerHTML = '<option value="">Select a section</option>';
    sections.forEach(section => {
        const option = document.createElement('option');
        option.value = section.id;
        option.textContent = section.displayName;
        sectionSelect.appendChild(option);
    });
    
    hideLoading();
    return sections;
  } catch (error) {
    console.error('Error loading sections:', error);
    showNotification('Failed to load sections. Please try again.');
    hideLoading();
    throw error;
  }
}

// Sync section flashcards (incremental)
async function syncSection(notebookId, sectionId) {
  if (isSyncing) {
    showNotification('Sync already in progress. Please wait.');
    return;
  }
  
  try {
    isSyncing = true;
    updateSyncStatus('Syncing...');
    updateButtons(true);
    
    syncButton.disabled = true;
    fullSyncButton.disabled = true;
    
    const response = await fetch(`/api/sync/section/${sectionId}`, {
      method: 'POST'
    });
    
    if (!response.ok) throw new Error('Sync failed');
    
    const result = await response.json();
    
    if (result.success) {
      await loadFlashcards();
      showNotification(`Sync complete! Updated ${result.cardsUpdated} flashcards.`);
      
      // Save last sync info
      saveLastSyncInfo(notebookId, sectionId);
    } else {
      showNotification('Sync failed. Please try again.');
    }
  } catch (error) {
    console.error('Error syncing section:', error);
    showNotification('Failed to sync. Please try again.');
  } finally {
    isSyncing = false;
    updateSyncStatus('');
    updateButtons(false);
    syncButton.disabled = false;
    fullSyncButton.disabled = false;
  }
}

// Perform full sync (for large note collections)
async function fullSync(notebookId, sectionId) {
  if (isSyncing) {
    showNotification('Sync already in progress. Please wait.');
    return;
  }
  
  try {
    // Confirm because this can take a while
    if (!confirm('Full sync may take several minutes for large note collections. Continue?')) {
      return;
    }
    
    isSyncing = true;
    updateSyncStatus('Performing full sync...');
    updateButtons(true);
    
    syncButton.disabled = true;
    fullSyncButton.disabled = true;
    
    // Request full sync
    const response = await fetch(`/api/sync/full/${notebookId}/${sectionId}`, {
      method: 'POST'
    });
    
    if (!response.ok) throw new Error('Full sync failed');
    
    const result = await response.json();
    
    if (result.success) {
      await loadFlashcards();
      showNotification(`Full sync complete! Created ${result.cardsUpdated} flashcards.`);
      
      // Save last sync info
      saveLastSyncInfo(notebookId, sectionId);
    } else {
      showNotification('Full sync failed. Please try again.');
    }
  } catch (error) {
    console.error('Error performing full sync:', error);
    showNotification('Failed to perform full sync. Please try again.');
  } finally {
    isSyncing = false;
    updateSyncStatus('');
    updateButtons(false);
    syncButton.disabled = false;
    fullSyncButton.disabled = false;
  }
}

// Save last sync information
async function saveLastSyncInfo(notebookId, sectionId) {
  try {
    await fetch('/api/sync/save-last', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ notebookId, sectionId })
    });
  } catch (error) {
    console.error('Error saving sync info:', error);
  }
}

// Load all flashcards
async function loadFlashcards() {
  try {
    showLoading('Loading flashcards...');
    const response = await fetch('/api/flashcards');
    if (!response.ok) throw new Error('Failed to fetch flashcards');
    
    allFlashcards = await response.json();
    renderPagesList();
    hideLoading();
  } catch (error) {
    console.error('Error loading flashcards:', error);
    hideLoading();
  }
}

// Filter pages by search term
function filterPages(searchTerm) {
  if (!searchTerm) {
    renderPagesList();
    return;
  }
  
  searchTerm = searchTerm.toLowerCase();
  
  const filteredPageIds = Object.keys(allFlashcards).filter(pageId => {
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
  
  renderPagesList(filteredPageIds);
}