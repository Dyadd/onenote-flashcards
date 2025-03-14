// Enhanced client-side app.js for OneNote Flashcards with OAuth support
// Optimized for large note collections and better UX

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
  // Initialize UI elements only after DOM is fully loaded
  initializeUI();
  init();
});

// Initialize UI elements
function initializeUI() {
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
}

// Initialize app
async function init() {
  try {
    // Check authentication status first
    await checkAuthStatus();
    
    // Setup event listeners
    setupEventListeners();
    
    // If authenticated, load content
    if (isAuthenticated) {
      await loadUserData();
    }
    
    // Check URL parameters for direct flashcard access
    checkUrlParams();
  } catch (error) {
    console.error('Initialization error:', error);
    showNotification('Error initializing app. Please refresh the page.', true);
  }
}

// Check if user is authenticated
async function checkAuthStatus() {
  try {
    const response = await fetch('/api/auth/status');
    const data = await response.json();
    
    isAuthenticated = data.authenticated;
    userName = data.userName;
    
    updateAuthUI();
  } catch (error) {
    console.error('Error checking auth status:', error);
    isAuthenticated = false;
    updateAuthUI();
  }
}

// Update UI based on authentication status
function updateAuthUI() {
  if (isAuthenticated) {
    // Show authenticated UI
    if (loginSection) loginSection.style.display = 'none';
    if (contentSection) contentSection.style.display = 'block';
    if (loginButton) loginButton.style.display = 'none';
    if (logoutButton) logoutButton.style.display = 'block';
    if (userInfo) userInfo.textContent = userName || 'User';
    if (authStatus) authStatus.textContent = 'Signed In';
  } else {
    // Show non-authenticated UI
    if (loginSection) loginSection.style.display = 'block';
    if (contentSection) contentSection.style.display = 'none';
    if (loginButton) loginButton.style.display = 'block';
    if (logoutButton) logoutButton.style.display = 'none';
    if (userInfo) userInfo.textContent = '';
    if (authStatus) authStatus.textContent = 'Not Signed In';
  }
}

// Load user data (notebooks, flashcards)
async function loadUserData() {
  try {
    await loadNotebooks();
    await loadFlashcards();
    
    // Check for last selected notebook/section
    loadLastSelection();
  } catch (error) {
    console.error('Error loading user data:', error);
    
    // If unauthorized, redirect to login
    if (error.status === 401) {
      window.location.href = '/auth/signin';
    } else {
      showNotification('Error loading your data. Please try again.', true);
    }
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

// Handle error responses from fetch requests
async function handleFetchResponse(response) {
  if (response.status === 401 || response.status === 403) {
    // Authentication issue
    window.location.href = '/auth/signin';
    throw { status: response.status, message: 'Authentication required' };
  }
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw { 
      status: response.status, 
      message: errorData.error || `Error: ${response.status} ${response.statusText}`
    };
  }
  
  return response.json();
}

// Load notebooks from API
async function loadNotebooks() {
  try {
    showLoading('Loading notebooks...');
    const response = await fetch('/api/notebooks');
    
    // Handle authentication errors
    if (response.status === 401) {
      // Redirect to login page
      window.location.href = '/auth/signin';
      throw { status: 401, message: 'Authentication required' };
    }
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch notebooks');
    }
    
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
    if (error.status !== 401) { // Don't show notification for auth errors
      showNotification('Failed to load notebooks. Please try again.', true);
    }
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
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/auth/signin';
        throw { status: 401, message: 'Authentication required' };
      }
      throw new Error('Failed to fetch sections');
    }
    
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
    if (error.status !== 401) {
      showNotification('Failed to load sections. Please try again.', true);
    }
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
    
    if (syncButton) syncButton.disabled = true;
    if (fullSyncButton) fullSyncButton.disabled = true;
    
    const response = await fetch(`/api/sync/section/${sectionId}`, {
      method: 'POST'
    });
    
    // Handle response with common error handler
    const result = await handleFetchResponse(response);
    
    if (result.success) {
      await loadFlashcards();
      showNotification(`Sync complete! Updated ${result.cardsUpdated} flashcards.`);
      
      // Save last sync info
      saveLastSyncInfo(notebookId, sectionId);
    } else {
      showNotification('Sync failed. Please try again.', true);
    }
  } catch (error) {
    console.error('Error syncing section:', error);
    if (error.status !== 401) { // Don't show notification for auth errors
      showNotification('Failed to sync. Please try again.', true);
    }
  } finally {
    isSyncing = false;
    updateSyncStatus('');
    updateButtons(false);
    if (syncButton) syncButton.disabled = false;
    if (fullSyncButton) fullSyncButton.disabled = false;
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
    
    if (syncButton) syncButton.disabled = true;
    if (fullSyncButton) fullSyncButton.disabled = true;
    
    // Request full sync
    const response = await fetch(`/api/sync/full/${notebookId}/${sectionId}`, {
      method: 'POST'
    });
    
    // Handle response with common error handler
    const result = await handleFetchResponse(response);
    
    if (result.success) {
      await loadFlashcards();
      showNotification(`Full sync complete! Created ${result.cardsUpdated} flashcards.`);
      
      // Save last sync info
      saveLastSyncInfo(notebookId, sectionId);
    } else {
      showNotification('Full sync failed. Please try again.', true);
    }
  } catch (error) {
    console.error('Error performing full sync:', error);
    if (error.status !== 401) {
      showNotification('Failed to perform full sync. Please try again.', true);
    }
  } finally {
    isSyncing = false;
    updateSyncStatus('');
    updateButtons(false);
    if (syncButton) syncButton.disabled = false;
    if (fullSyncButton) fullSyncButton.disabled = false;
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
    
    // Handle response with common error handler
    allFlashcards = await handleFetchResponse(response);
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

// Render pages list with flashcards
function renderPagesList(specificPageIds) {
    if (!pagesList) return;
    
    pagesList.innerHTML = '';
    
    // Use provided pageIds or all pages
    const pageIds = specificPageIds || Object.keys(allFlashcards);
    
    if (pageIds.length === 0) {
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        listItem.textContent = specificPageIds 
            ? 'No matching flashcards found.' 
            : 'No flashcards yet. Sync to create them.';
        pagesList.appendChild(listItem);
        return;
    }
    
    // Sort pages by title for better organization
    pageIds.sort((a, b) => {
        const titleA = allFlashcards[a]?.pageTitle || '';
        const titleB = allFlashcards[b]?.pageTitle || '';
        return titleA.localeCompare(titleB);
    });
    
    pageIds.forEach(pageId => {
        if (!allFlashcards[pageId]) return;
        
        const pageData = allFlashcards[pageId];
        const cardCount = pageData.cards.length;
        
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        
        // Highlight currently selected page
        if (pageId === currentPageId) {
            listItem.classList.add('active');
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
    const resultCountContainer = document.createElement('div');
    resultCountContainer.className = 'text-muted small mt-2';
    resultCountContainer.textContent = `Showing ${pageIds.length} pages`;
    
    // Remove any existing count before adding new one
    const existingCount = pagesList.parentNode.querySelector('.text-muted.small.mt-2');
    if (existingCount) {
        existingCount.remove();
    }
    
    pagesList.parentNode.appendChild(resultCountContainer);
    
    // Update pages count badge if it exists
    const pagesCount = document.getElementById('pages-count');
    if (pagesCount) {
        pagesCount.textContent = pageIds.length;
    }
}

// Select a page and show its flashcards
function selectPage(pageId) {
    if (!allFlashcards[pageId]) {
        showNotification('Selected page not found');
        return;
    }
    
    currentPageId = pageId;
    currentCardIndex = 0;
    
    const pageData = allFlashcards[pageId];
    currentPageTitle.textContent = pageData.pageTitle;
    
    // Update URL for sharing without reloading
    const url = new URL(window.location);
    url.searchParams.set('page', pageId);
    window.history.pushState({}, '', url);
    
    renderCurrentCard();
    
    // Highlight selected page
    const pageItems = pagesList.querySelectorAll('li');
    pageItems.forEach(item => {
        item.classList.remove('active');
        if (item.querySelector('.page-title') && 
            item.querySelector('.page-title').textContent === pageData.pageTitle) {
            item.classList.add('active');
        }
    });
    
    // Display share link
    const shareLink = document.getElementById('share-link');
    if (shareLink) {
        shareLink.style.display = 'block';
        shareLink.onclick = () => {
            const shareUrl = getShareableUrl(pageId);
            navigator.clipboard.writeText(shareUrl).then(() => {
                showNotification('Link copied to clipboard!');
            });
        };
    }
}

// Helper function to get current user's flashcards for a specific page
function getCurrentUserFlashcards(pageId) {
    if (!pageId || !allFlashcards || Object.keys(allFlashcards).length === 0) {
        return null;
    }
    
    return allFlashcards[pageId];
}

// Render current flashcard
function renderCurrentCard() {
    if (!isAuthenticated) {
        return; // Don't render if not authenticated
    }
    
    if (!currentPageId || !getCurrentUserFlashcards(currentPageId)) {
        questionElement.textContent = 'Select a page to view flashcards';
        answerElement.textContent = '';
        answerElement.classList.add('hidden');
        prevButton.disabled = true;
        nextButton.disabled = true;
        toggleButton.disabled = true;
        cardCounter.textContent = '0/0';
        return;
    }
    
    const pageData = getCurrentUserFlashcards(currentPageId);
    const cards = pageData.cards;
    
    if (!cards || cards.length === 0) {
        questionElement.textContent = 'No flashcards for this page yet';
        answerElement.textContent = '';
        answerElement.classList.add('hidden');
        prevButton.disabled = true;
        nextButton.disabled = true;
        toggleButton.disabled = true;
        cardCounter.textContent = '0/0';
        return;
    }
    
    const currentCard = cards[currentCardIndex];
    
    // Format content nicely
    questionElement.innerHTML = formatContent(currentCard.question);
    answerElement.innerHTML = formatContent(currentCard.answer);
    answerElement.classList.add('hidden');
    
    toggleButton.textContent = 'Show Answer';
    toggleButton.disabled = false;
    prevButton.disabled = currentCardIndex === 0;
    nextButton.disabled = currentCardIndex === cards.length - 1;
    
    cardCounter.textContent = `${currentCardIndex + 1}/${cards.length}`;
    
    // Add auto-advance checkbox if we have multiple cards
    if (cards.length > 1) {
        const autoAdvanceContainer = document.getElementById('auto-advance-container');
        if (autoAdvanceContainer) {
            autoAdvanceContainer.style.display = 'block';
        }
    }
}

// Format flashcard content with basic formatting
function formatContent(text) {
    if (!text) return '';
    
    // Convert line breaks to paragraphs
    let formatted = text.split('\n\n').map(para => `<p>${para}</p>`).join('');
    
    // Handle single line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Bold important terms (text between asterisks or terms followed by colon)
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\b([A-Za-z\s]+):/g, '<strong>$1:</strong>');
    
    return formatted;
}

// Setup event listeners
function setupEventListeners() {
    // Authentication buttons
    if (loginButton) {
        loginButton.addEventListener('click', () => {
            window.location.href = '/auth/signin';
        });
    }
    
    if (loginButtonMain) {
        loginButtonMain.addEventListener('click', () => {
            window.location.href = '/auth/signin';
        });
    }
    
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            window.location.href = '/auth/signout';
        });
    }
    
    // Notebook selection
    if (notebookSelect) {
        notebookSelect.addEventListener('change', () => {
            currentNotebookId = notebookSelect.value;
            if (currentNotebookId) {
                loadSections(currentNotebookId);
                saveSelection();
            }
        });
    }
    
    // Section selection
    if (sectionSelect) {
        sectionSelect.addEventListener('change', () => {
            currentSectionId = sectionSelect.value;
            if (syncButton) syncButton.disabled = !currentSectionId;
            if (fullSyncButton) fullSyncButton.disabled = !currentSectionId;
            saveSelection();
        });
    }
    
    // Incremental sync button
    if (syncButton) {
        syncButton.addEventListener('click', () => {
            if (currentNotebookId && currentSectionId) {
                syncSection(currentNotebookId, currentSectionId);
            }
        });
    }
    
    // Full sync button
    if (fullSyncButton) {
        fullSyncButton.addEventListener('click', () => {
            if (currentNotebookId && currentSectionId) {
                fullSync(currentNotebookId, currentSectionId);
            }
        });
    }
    
    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterPages(e.target.value);
        });
        
        // Clear search
        const clearSearchBtn = document.getElementById('clear-search');
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                renderPagesList();
            });
        }
    }
    
    // Flashcard navigation
    if (prevButton) {
        prevButton.addEventListener('click', () => {
            if (currentCardIndex > 0) {
                currentCardIndex--;
                renderCurrentCard();
            }
        });
    }
    
    if (nextButton) {
        nextButton.addEventListener('click', () => {
            const cards = getCurrentUserFlashcards(currentPageId)?.cards || [];
            if (currentCardIndex < cards.length - 1) {
                currentCardIndex++;
                renderCurrentCard();
            }
        });
    }
    
    // Show/hide answer
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            answerElement.classList.toggle('hidden');
            toggleButton.textContent = answerElement.classList.contains('hidden') ? 'Show Answer' : 'Hide Answer';
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Only if we're viewing flashcards and authenticated
        if (!currentPageId || !isAuthenticated) return;
        
        switch(e.key) {
            case 'ArrowLeft':
                // Previous card
                if (prevButton && !prevButton.disabled) {
                    prevButton.click();
                }
                break;
            case 'ArrowRight':
                // Next card
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                }
                break;
            case ' ':
                // Space bar to toggle answer
                if (toggleButton && !toggleButton.disabled) {
                    toggleButton.click();
                    e.preventDefault(); // Prevent scrolling
                }
                break;
        }
    });
    
    // Auto-advance setup
    setupAutoAdvance();
}