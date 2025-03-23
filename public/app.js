// OneNote Flashcards with Anki Features
// Complete implementation with spaced repetition, statistics, and view management

// State management
let currentNotebookId = '';
let currentSectionId = '';
let allFlashcards = {};
let currentPageId = '';
let currentCardIndex = 0;
let isSyncing = false;
let autoAdvanceTimer = null;
let userStudyStats = {};
let userSettings = {};
let tagList = [];
let activeFilters = {
    tags: [],
    difficulty: 'all',
    status: 'all'
};
let studyStartTime = null;
let studySession = {
    active: false,
    queue: [],
    currentIndex: 0
};
let currentView = 'home'; // Track current view for navigation
let pendingSaves = []; // For offline handling

// Card scheduling constants (Anki-like algorithms)
const EASE_FACTOR_DEFAULT = 2.5;
const EASE_MODIFIER_HARD = 0.85;
const EASE_MODIFIER_GOOD = 1.0;
const EASE_MODIFIER_EASY = 1.3;
const INTERVAL_MODIFIER = 1.0;
const NEW_INTERVAL_HARD = 0.6; // 60% of previous interval
const MIN_INTERVAL = 1; // 1 day minimum
const MAX_INTERVAL = 365 * 4; // 4 years maximum

// Initialize app when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    init();
});

function debugDeckCounts() {
    console.log("========== DECK COUNT DIAGNOSTICS ==========");
    Object.keys(allFlashcards).forEach(pageId => {
        const page = allFlashcards[pageId];
        if (!page.cards) return;
        
        let newCount = 0;
        let dueCount = 0;
        let reviewedCount = 0;
        
        const today = new Date();
        
        page.cards.forEach(card => {
            if (card.suspended) return;
            
            if (!card.due) {
                newCount++;
            } else if (new Date(card.due) <= today) {
                dueCount++;
            } else if (card.reviewCount > 0) {
                reviewedCount++;
            }
        });
        
        console.log(`Deck: ${page.pageTitle}`);
        console.log(`- New: ${newCount}, Due: ${dueCount}, Reviewed: ${reviewedCount}`);
        console.log(`- Total Cards: ${page.cards.length}`);
    });
    console.log("===========================================");
}

// View Management Functions
function showView(viewName) {
    console.log(`Switching to view: ${viewName}`);
    
    // Hide all views first
    document.querySelectorAll('.app-view').forEach(view => {
        view.style.display = 'none';
    });
    
    // Show the requested view
    const viewToShow = document.getElementById(`${viewName}-view`);
    if (viewToShow) {
        viewToShow.style.display = 'block';
        currentView = viewName;
        
        // Update active state in navigation
        document.querySelectorAll('.nav-list .nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Find the corresponding nav item and make it active
        const navItem = document.getElementById(`nav-${viewName}`);
        if (navItem) {
            navItem.classList.add('active');
        }
        
        // Handle special view initialization
        if (viewName === 'study' && studySession.active) {
            updateStudyStatusDisplay();
        } else if (viewName === 'stats') {
            updateDetailedStats();
        }
    } else {
        console.error(`View not found: ${viewName}`);
    }
}

// Update views based on authentication status
function updateViewsBasedOnAuth(isAuthenticated) {
    if (isAuthenticated) {
        // Show content relevant to logged-in users
        document.querySelectorAll('.auth-required').forEach(el => {
            el.style.display = 'block';
        });
        document.querySelectorAll('.auth-hidden').forEach(el => {
            el.style.display = 'none';
        });
        showView('home'); // Default view for authenticated users
    } else {
        // Show only login-related content
        document.querySelectorAll('.auth-required').forEach(el => {
            el.style.display = 'none';
        });
        document.querySelectorAll('.auth-hidden').forEach(el => {
            el.style.display = 'block';
        });
        showView('login');
    }
}

// Setup navigation
function setupNavigation() {
    // Set up click handlers for main navigation
    document.querySelectorAll('.nav-list .nav-item a[data-view]').forEach(link => {
        link.addEventListener('click', (e) => {
            const viewName = e.currentTarget.dataset.view;
            if (viewName) {
                e.preventDefault();
                showView(viewName);
            }
        });
    });
    
    // Add back button support
    document.querySelectorAll('.back-button').forEach(button => {
        button.addEventListener('click', () => {
            showView('home');
        });
    });
}

// Main initialization function
async function init() {
    console.log('Initializing application...');
    try {
        // Setup auth buttons first, before anything else
        setupAuthButtons();
        
        // Setup navigation
        setupNavigation();
        
        // Load user settings
        loadUserSettings();
        
        // Check authentication status first
        const authStatus = await checkAuthStatus();
        console.log(`Auth status: ${authStatus.authenticated ? 'Authenticated' : 'Not authenticated'}`);
        
        // Setup all event listeners
        setupEventListeners();
        
        // Update views based on authentication
        updateViewsBasedOnAuth(authStatus.authenticated);
        
        // If authenticated, load user content
        if (authStatus.authenticated) {
            console.log('User is authenticated, loading content...');
            await loadUserData();
            
            // Load study stats
            loadStudyStats();
            
            // Update stats display
            updateStatsDisplay();
            
            // Update heatmap
            updateHeatmap();
            
            // Apply spaced repetition UI based on settings
            toggleSpacedRepetitionUI();
            
            // Load and display due counts
            updateDueCounts();
        }
        
        // Check URL for direct flashcard access
        checkUrlParameters();
        
        // Check for interrupted study session
        const savedSession = localStorage.getItem('studySession');
        if (savedSession) {
            try {
                const parsedSession = JSON.parse(savedSession);
                if (parsedSession.active && parsedSession.queue && parsedSession.queue.length > 0) {
                    studySession = parsedSession;
                    // Ask if user wants to continue
                    if (confirm('Do you want to continue your previous study session?')) {
                        showView('study');
                        showStudyCard();
                    } else {
                        localStorage.removeItem('studySession');
                        studySession = {
                            active: false,
                            queue: [],
                            currentIndex: 0
                        };
                    }
                }
            } catch (e) {
                console.error('Error parsing saved study session:', e);
            }
        }

        // Set up online/offline detection for saving to server
        window.addEventListener('online', processPendingSaves);
        window.addEventListener('offline', () => {
            console.log('Device is offline. Saves will be queued.');
        });
        
        console.log('Initialization complete');
    } catch (error) {
        console.error('Initialization error:', error);
        showNotification('Error initializing app. Please refresh the page.', true);
    }
}

// Process any pending saves when coming back online
async function processPendingSaves() {
    if (!navigator.onLine || pendingSaves.length === 0) return;
    
    console.log(`Processing ${pendingSaves.length} pending saves`);
    
    try {
        showLoading('Syncing saved changes...');
        
        // Process oldest first (sort by timestamp)
        pendingSaves.sort((a, b) => a.timestamp - b.timestamp);
        
        // Try to save each one
        for (let i = 0; i < pendingSaves.length; i++) {
            const saveData = pendingSaves[i];
            try {
                const response = await fetch('/api/flashcards/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(saveData.data)
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to process save: ${response.status}`);
                }
            } catch (error) {
                console.error('Error processing save:', error);
                // If we fail, leave remaining saves in the queue
                pendingSaves = pendingSaves.slice(i);
                localStorage.setItem('pendingSaves', JSON.stringify(pendingSaves));
                hideLoading();
                return;
            }
        }
        
        // If we get here, all saves were processed
        pendingSaves = [];
        localStorage.removeItem('pendingSaves');
        hideLoading();
        console.log('All pending saves processed successfully');
    } catch (error) {
        console.error('Error processing pending saves:', error);
        hideLoading();
    }
}

// Load user settings from localStorage
function loadUserSettings() {
    try {
        const savedSettings = localStorage.getItem('userSettings');
        if (savedSettings) {
            userSettings = JSON.parse(savedSettings);
        } else {
            // Default settings
            userSettings = {
                newCardsPerDay: 20,
                reviewsPerDay: 100,
                showImages: true,
                useSpacedRepetition: true,
                autoplayAudio: false,
                nightMode: false,
                cardOrderNew: 'due', // 'due', 'random', 'added'
                cardOrderReview: 'due' // 'due', 'random'
            };
            saveUserSettings();
        }
        
        // Apply settings to UI
        applyUserSettings();
    } catch (error) {
        console.error('Error loading user settings:', error);
        // Reset to defaults if error
        userSettings = {
            newCardsPerDay: 20,
            reviewsPerDay: 100,
            showImages: true,
            useSpacedRepetition: true,
            autoplayAudio: false,
            nightMode: false,
            cardOrderNew: 'due',
            cardOrderReview: 'due'
        };
    }
}

// Save user settings to localStorage
function saveUserSettings() {
    try {
        localStorage.setItem('userSettings', JSON.stringify(userSettings));
    } catch (error) {
        console.error('Error saving user settings:', error);
    }
}

// Apply settings to UI
function applyUserSettings() {
    // Apply night mode if enabled
    if (userSettings.nightMode) {
        document.body.classList.add('night-mode');
    } else {
        document.body.classList.remove('night-mode');
    }
    
    // Update settings panel inputs to match current settings
    const nightModeToggle = document.getElementById('night-mode-toggle');
    const newCardsInput = document.getElementById('new-cards-per-day');
    const reviewsInput = document.getElementById('reviews-per-day');
    const spacedRepToggle = document.getElementById('spaced-rep-toggle');
    const autoplayToggle = document.getElementById('autoplay-toggle');
    const newCardOrderSelect = document.getElementById('new-card-order');
    const reviewCardOrderSelect = document.getElementById('review-card-order');
    
    if (nightModeToggle) nightModeToggle.checked = userSettings.nightMode;
    if (newCardsInput) newCardsInput.value = userSettings.newCardsPerDay;
    if (reviewsInput) reviewsInput.value = userSettings.reviewsPerDay;
    if (spacedRepToggle) spacedRepToggle.checked = userSettings.useSpacedRepetition;
    if (autoplayToggle) autoplayToggle.checked = userSettings.autoplayAudio;
    if (newCardOrderSelect) newCardOrderSelect.value = userSettings.cardOrderNew;
    if (reviewCardOrderSelect) reviewCardOrderSelect.value = userSettings.cardOrderReview;
}

// Load study statistics from localStorage
function loadStudyStats() {
    try {
        const savedStats = localStorage.getItem('userStudyStats');
        if (savedStats) {
            userStudyStats = JSON.parse(savedStats);
        } else {
            // Initialize empty stats
            userStudyStats = {
                cardsStudied: 0,
                totalReviews: 0,
                correctReviews: 0,
                studyTimeMinutes: 0,
                streakDays: 0,
                lastStudyDate: null,
                reviewHistory: [],
                deckStats: {}
            };
            saveStudyStats();
        }
        
        // Update streak
        updateStudyStreak();
    } catch (error) {
        console.error('Error loading study stats:', error);
        userStudyStats = {
            cardsStudied: 0,
            totalReviews: 0,
            correctReviews: 0,
            studyTimeMinutes: 0,
            streakDays: 0,
            lastStudyDate: null,
            reviewHistory: [],
            deckStats: {}
        };
    }
}

// Save study statistics to localStorage
function saveStudyStats() {
    try {
        localStorage.setItem('userStudyStats', JSON.stringify(userStudyStats));
    } catch (error) {
        console.error('Error saving study stats:', error);
    }
}

// Update study streak based on last study date
function updateStudyStreak() {
    const today = new Date().toISOString().split('T')[0];
    const lastStudyDate = userStudyStats.lastStudyDate;
    
    if (lastStudyDate) {
        // Already studied today
        if (lastStudyDate === today) {
            return;
        }
        
        // Check if studied yesterday
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = yesterdayDate.toISOString().split('T')[0];
        
        if (lastStudyDate === yesterday) {
            // Studied yesterday, increment streak
            userStudyStats.streakDays++;
        } else {
            // Streak broken
            userStudyStats.streakDays = 1;
        }
    } else {
        // First time studying
        userStudyStats.streakDays = 1;
    }
    
    userStudyStats.lastStudyDate = today;
    saveStudyStats();
}

// Record a card review in study statistics
function recordCardReview(cardIndex, pageId, result) {
    // Update global stats
    userStudyStats.totalReviews++;
    
    if (result === 'good' || result === 'easy') {
        userStudyStats.correctReviews++;
    }
    
    const card = allFlashcards[pageId]?.cards[cardIndex];
    if (!card) return;
    
    // If first time seeing this card, increment cardsStudied
    if (!card.reviewCount || card.reviewCount === 0) {
        userStudyStats.cardsStudied++;
    }
    
    // Add to review history with enhanced data
    userStudyStats.reviewHistory.push({
        date: new Date().toISOString(),
        cardIndex: cardIndex,
        pageId: pageId,
        cardId: card.id || `${pageId}-${cardIndex}`, // Add unique card identifier
        result: result,
        previousInterval: card.interval || 0,
        newInterval: card.interval, // The newly calculated interval
        ease: card.ease
    });
    
    // Ensure history doesn't grow too large (keep last 1000 reviews)
    if (userStudyStats.reviewHistory.length > 1000) {
        userStudyStats.reviewHistory = userStudyStats.reviewHistory.slice(-1000);
    }
    
    // Update deck/page stats
    if (!userStudyStats.deckStats[pageId]) {
        userStudyStats.deckStats[pageId] = {
            cardsStudied: 0,
            totalReviews: 0,
            correctReviews: 0
        };
    }
    
    userStudyStats.deckStats[pageId].totalReviews++;
    
    if (result === 'good' || result === 'easy') {
        userStudyStats.deckStats[pageId].correctReviews++;
    }
    
    // If first time seeing this card in this deck, increment cardsStudied
    if (!card.reviewCount || card.reviewCount === 0) {
        userStudyStats.deckStats[pageId].cardsStudied++;
    }
    
    // Update streak
    updateStudyStreak();
    
    // Save stats
    saveStudyStats();
    
    // Update stats display
    updateStatsDisplay();
    
    // Update heatmap
    updateHeatmap();
}

// Update the stats display in the UI
function updateStatsDisplay() {
    const statsContainer = document.getElementById('stats-container');
    if (!statsContainer) return;
    
    // Calculate retention rate
    const retentionRate = userStudyStats.totalReviews > 0 
        ? (userStudyStats.correctReviews / userStudyStats.totalReviews * 100).toFixed(1) 
        : 0;
    
    // Count due cards
    const { dueCount, newCount, totalCount } = getDueCounts();
    
    statsContainer.innerHTML = `
        <div class="stats-row">
            <div class="stat-item">
                <div class="stat-value">${userStudyStats.cardsStudied}</div>
                <div class="stat-label">Cards Learned</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${userStudyStats.totalReviews}</div>
                <div class="stat-label">Reviews</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${retentionRate}%</div>
                <div class="stat-label">Retention</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${userStudyStats.streakDays}</div>
                <div class="stat-label">Day Streak</div>
            </div>
        </div>
        <div class="stats-row mt-3">
            <div class="stat-item">
                <div class="stat-value">${dueCount}</div>
                <div class="stat-label">Due Today</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${newCount}</div>
                <div class="stat-label">New Cards</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${totalCount}</div>
                <div class="stat-label">Total Cards</div>
            </div>
        </div>
    `;
    
    // Update detailed stats modal
    updateDetailedStats();
}

// Update the detailed statistics modal
function updateDetailedStats() {
    const detailedStatsContainer = document.getElementById('detailed-stats-container');
    if (!detailedStatsContainer) return;
    
    // Calculate retention rate
    const retentionRate = userStudyStats.totalReviews > 0 
        ? (userStudyStats.correctReviews / userStudyStats.totalReviews * 100).toFixed(1) 
        : 0;
    
    // Calculate reviews per day
    const reviewDays = new Set(userStudyStats.reviewHistory.map(r => r.date.split('T')[0])).size;
    const averageReviews = reviewDays > 0 
        ? (userStudyStats.totalReviews / reviewDays).toFixed(1) 
        : 0;
    
    // Format review history for chart
    const reviewByDay = {};
    userStudyStats.reviewHistory.forEach(review => {
        const day = review.date.split('T')[0];
        if (!reviewByDay[day]) {
            reviewByDay[day] = { total: 0, correct: 0 };
        }
        reviewByDay[day].total++;
        if (review.result === 'good' || review.result === 'easy') {
            reviewByDay[day].correct++;
        }
    });
    
    // Get deck-specific stats
    const deckStats = Object.entries(userStudyStats.deckStats).map(([pageId, stats]) => {
        const deckName = allFlashcards[pageId]?.pageTitle || 'Unknown Deck';
        const deckRetention = stats.totalReviews > 0 
            ? (stats.correctReviews / stats.totalReviews * 100).toFixed(1) 
            : 0;
        
        return {
            deckName,
            cardsStudied: stats.cardsStudied,
            totalReviews: stats.totalReviews,
            retention: deckRetention
        };
    });
    
    // Build HTML for detailed stats
    let deckStatsHtml = '';
    if (deckStats.length > 0) {
        deckStatsHtml = `
            <div class="table-responsive mt-4">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Deck</th>
                            <th>Cards</th>
                            <th>Reviews</th>
                            <th>Retention</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${deckStats.map(deck => `
                            <tr>
                                <td>${deck.deckName}</td>
                                <td>${deck.cardsStudied}</td>
                                <td>${deck.totalReviews}</td>
                                <td>${deck.retention}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    // Create HTML for detailed stats
    detailedStatsContainer.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <div class="card shadow-sm mb-4">
                    <div class="card-body">
                        <h5 class="card-title">Overview</h5>
                        <div class="row">
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Total Cards Studied</div>
                                    <div class="h3">${userStudyStats.cardsStudied}</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Total Reviews</div>
                                    <div class="h3">${userStudyStats.totalReviews}</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Retention Rate</div>
                                    <div class="h3">${retentionRate}%</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Day Streak</div>
                                    <div class="h3">${userStudyStats.streakDays}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="card shadow-sm">
                    <div class="card-body">
                        <h5 class="card-title">Study Habits</h5>
                        <div class="row">
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Study Days</div>
                                    <div class="h3">${reviewDays}</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Reviews per Day</div>
                                    <div class="h3">${averageReviews}</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Study Time (mins)</div>
                                    <div class="h3">${userStudyStats.studyTimeMinutes || 0}</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-3">
                                    <div class="text-muted">Last Study</div>
                                    <div class="h3">${userStudyStats.lastStudyDate ? formatDate(new Date(userStudyStats.lastStudyDate)) : 'Never'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="col-md-6">
                <div class="card shadow-sm">
                    <div class="card-body">
                        <h5 class="card-title">Activity</h5>
                        <div class="detailed-heatmap mb-3">
                            <!-- Detailed heatmap would go here (using a library in production) -->
                            <div id="detailed-heatmap-placeholder" class="mb-3 p-3 bg-light text-center">
                                <i class="bi bi-calendar-week me-2"></i>Study activity heatmap
                            </div>
                        </div>
                        <h5 class="card-title">Deck Statistics</h5>
                        ${deckStatsHtml || '<p class="text-muted">No deck statistics available yet</p>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Helper function to format date
function formatDate(date) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Get counts of due and new cards
function getDueCounts() {
    const today = new Date();
    let dueCount = 0;
    let newCount = 0;
    let totalCount = 0;
    
    Object.values(allFlashcards).forEach(page => {
        if (!page.cards) return;
        
        totalCount += page.cards.length;
        
        page.cards.forEach(card => {
            if (!card) return;
            
            if (card.suspended) return; // Skip suspended cards
            
            if (!card.due) {
                // Card has never been reviewed
                newCount++;
            } else {
                // Check if card is due
                const dueDate = new Date(card.due);
                if (dueDate <= today) {
                    dueCount++;
                }
            }
        });
    });
    
    return { dueCount, newCount, totalCount };
}

// Update due counts in the UI
function updateDueCounts() {
    const { dueCount, newCount } = getDueCounts();
    const totalDue = dueCount + newCount;
    
    // Update study now button
    const studyNowButton = document.getElementById('study-now-button');
    if (studyNowButton) {
        if (totalDue > 0) {
            studyNowButton.innerHTML = `<i class="bi bi-play-fill me-1"></i>Study (${totalDue})`;
            studyNowButton.disabled = false;
        } else {
            studyNowButton.innerHTML = `<i class="bi bi-play-fill me-1"></i>Study`;
            studyNowButton.disabled = false; // Still allow study if no due cards
        }
    }
    
    // Update stats display
    updateStatsDisplay();
}

// Update the heatmap visualization
function updateHeatmap() {
    const heatmapContainer = document.getElementById('heatmap-container');
    if (!heatmapContainer) return;
    
    // Get review history
    const reviewHistory = userStudyStats.reviewHistory || [];
    
    // Count reviews per day for the last 365 days
    const reviewCounts = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Initialize all dates for the last year
    for (let i = 0; i < 365; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        reviewCounts[dateStr] = 0;
    }
    
    // Count reviews per day
    reviewHistory.forEach(review => {
        const dateStr = review.date.split('T')[0];
        if (reviewCounts[dateStr] !== undefined) {
            reviewCounts[dateStr]++;
        }
    });
    
    // Create heatmap cells for the last 7 days
    const lastWeekContainer = document.createElement('div');
    lastWeekContainer.className = 'heatmap-week';
    
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = reviewCounts[dateStr] || 0;
        
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.dataset.date = dateStr;
        cell.dataset.count = count;
        cell.classList.add(getHeatmapColorClass(count));
        cell.title = `${formatDate(date)}: ${count} reviews`;
        
        lastWeekContainer.appendChild(cell);
    }
    
    // Clear and update heatmap
    heatmapContainer.innerHTML = '<h6 class="mb-3">Activity</h6>';
    heatmapContainer.appendChild(lastWeekContainer);
    
    // Add a section for month view (last 30 days)
    const monthContainer = document.createElement('div');
    monthContainer.className = 'heatmap-month mt-2';
    
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = reviewCounts[dateStr] || 0;
        
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.dataset.date = dateStr;
        cell.dataset.count = count;
        cell.classList.add(getHeatmapColorClass(count));
        cell.title = `${formatDate(date)}: ${count} reviews`;
        
        monthContainer.appendChild(cell);
    }
    
    heatmapContainer.appendChild(monthContainer);
}

// Get color class for heatmap based on count
function getHeatmapColorClass(count) {
    if (count === 0) return 'heat-0';
    if (count < 5) return 'heat-1';
    if (count < 10) return 'heat-2';
    if (count < 20) return 'heat-3';
    return 'heat-4';
}

// Check if user is authenticated
async function checkAuthStatus() {
    console.log('Checking authentication status...');
    try {
        const response = await fetch('/api/auth/status');
        
        if (!response.ok) {
            throw new Error(`Auth check failed: ${response.status}`);
        }
        
        const data = await response.json();
        updateAuthUI(data.authenticated, data.userName);
        return data;
    } catch (error) {
        console.error('Auth check error:', error);
        updateAuthUI(false);
        return { authenticated: false };
    }
}

// Update UI based on authentication status
function updateAuthUI(isAuthenticated, userName = '') {
    console.log(`Updating auth UI: authenticated=${isAuthenticated}, user=${userName}`);
    
    const authStatus = document.getElementById('auth-status');
    const userInfo = document.getElementById('user-info');
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    
    if (isAuthenticated) {
        if (authStatus) authStatus.textContent = 'Signed In';
        if (userInfo) userInfo.textContent = userName;
        if (loginButton) loginButton.style.display = 'none';
        if (logoutButton) logoutButton.style.display = 'block';
    } else {
        if (authStatus) authStatus.textContent = 'Not Signed In';
        if (userInfo) userInfo.textContent = '';
        if (loginButton) loginButton.style.display = 'block';
        if (logoutButton) logoutButton.style.display = 'none';
    }
}

// Setup all event listeners
function setupEventListeners() {
    console.log('Setting up event listeners');
    
    // Authentication buttons
    setupAuthButtons();
    
    // Notebook and section selection
    setupSelectionListeners();
    
    // Sync buttons
    setupSyncButtons();
    
    // Search functionality
    setupSearchListeners();
    
    // Flashcard navigation
    setupFlashcardControls();
    
    // Add Card button
    const addCardButton = document.getElementById('add-card-button');
    if (addCardButton) {
        addCardButton.addEventListener('click', openAddCardModal);
    }
    
    // Save new card button
    const saveNewCardButton = document.getElementById('save-new-card');
    if (saveNewCardButton) {
        saveNewCardButton.addEventListener('click', saveNewCard);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyPress);
    
    // Auto-advance feature
    setupAutoAdvance();
    
    // Share button
    setupShareButton();
    
    // Settings panel
    setupSettingsPanel();
    
    // Tags filter
    setupTagsFilter();
    
    // Study options
    setupStudyOptions();
    
    // Batch editing
    setupBatchEditing();
    
    // Card editor
    setupCardEditor();
    
    // Stats and help modals
    setupModals();
}

function setupAuthButtons() {
    // Main login button
    const loginButtonMain = document.getElementById('login-button-main');
    if (loginButtonMain) {
        console.log('Found main login button, adding click handler');
        loginButtonMain.addEventListener('click', () => {
            console.log('Main login button clicked');
            window.location.href = '/auth/signin';
        });
    } else {
        console.error('login-button-main not found in DOM');
    }
    
    // Navbar login button
    const loginButton = document.getElementById('login-button');
    if (loginButton) {
        console.log('Found navbar login button, adding click handler');
        loginButton.addEventListener('click', () => {
            console.log('Navbar login button clicked');
            window.location.href = '/auth/signin';
        });
    } else {
        console.error('login-button not found in DOM');
    }
    
    // Logout button
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            window.location.href = '/auth/signout';
        });
    }
}

function setupSelectionListeners() {
    // Notebook selection
    const notebookSelect = document.getElementById('notebook-select');
    if (notebookSelect) {
        notebookSelect.addEventListener('change', async function() {
            const notebookId = this.value;
            if (!notebookId) return;
            
            currentNotebookId = notebookId;
            currentSectionId = '';
            
            // Disable sync buttons until section is selected
            const syncButton = document.getElementById('sync-button');
            const fullSyncButton = document.getElementById('full-sync-button');
            if (syncButton) syncButton.disabled = true;
            if (fullSyncButton) fullSyncButton.disabled = true;
            
            // Load sections for selected notebook
            await loadSections(notebookId);
        });
    }
    
    // Section selection
    const sectionSelect = document.getElementById('section-select');
    if (sectionSelect) {
        sectionSelect.addEventListener('change', function() {
            const sectionId = this.value;
            if (!sectionId) return;
            
            currentSectionId = sectionId;
            
            // Enable sync buttons
            const syncButton = document.getElementById('sync-button');
            const fullSyncButton = document.getElementById('full-sync-button');
            if (syncButton) syncButton.disabled = false;
            if (fullSyncButton) fullSyncButton.disabled = false;
            
            // Save selection for future visits
            saveSelection();
        });
    }
}

function setupSyncButtons() {
    // Quick sync button
    const syncButton = document.getElementById('sync-button');
    if (syncButton) {
        syncButton.addEventListener('click', () => {
            if (currentNotebookId && currentSectionId) {
                syncSection(currentNotebookId, currentSectionId);
            } else {
                showNotification('Please select a notebook and section first', true);
            }
        });
    }
    
    // Full sync button
    const fullSyncButton = document.getElementById('full-sync-button');
    if (fullSyncButton) {
        fullSyncButton.addEventListener('click', () => {
            if (currentNotebookId && currentSectionId) {
                fullSync(currentNotebookId, currentSectionId);
            } else {
                showNotification('Please select a notebook and section first', true);
            }
        });
    }
}

function setupSearchListeners() {
    // Search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        // Use debounce for better performance
        const debouncedSearch = debounce(function() {
            filterPages(this.value);
        }, 300);
        
        searchInput.addEventListener('input', debouncedSearch);
    }
    
    // Clear search button
    const clearSearch = document.getElementById('clear-search');
    if (clearSearch) {
        clearSearch.addEventListener('click', function() {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = '';
                filterPages('');
            }
        });
    }
}

function setupFlashcardControls() {
    // Previous button
    const prevButton = document.getElementById('prev-button');
    if (prevButton) {
        prevButton.addEventListener('click', showPreviousCard);
    }
    
    // Next button
    const nextButton = document.getElementById('next-button');
    if (nextButton) {
        nextButton.addEventListener('click', showNextCard);
    }
    
    // Toggle answer button
    const toggleButton = document.getElementById('toggle-button');
    if (toggleButton) {
        toggleButton.addEventListener('click', toggleAnswer);
    }
    
    // Answer buttons (for spaced repetition)
    const againButton = document.getElementById('answer-again');
    if (againButton) {
        againButton.addEventListener('click', () => answerCard('again'));
    }
    
    const hardButton = document.getElementById('answer-hard');
    if (hardButton) {
        hardButton.addEventListener('click', () => answerCard('hard'));
    }
    
    const goodButton = document.getElementById('answer-good');
    if (goodButton) {
        goodButton.addEventListener('click', () => answerCard('good'));
    }
    
    const easyButton = document.getElementById('answer-easy');
    if (easyButton) {
        easyButton.addEventListener('click', () => answerCard('easy'));
    }
    
    // Study mode controls
    const studyShowAnswerBtn = document.getElementById('study-show-answer');
    if (studyShowAnswerBtn) {
        studyShowAnswerBtn.addEventListener('click', showStudyAnswer);
    }
    
    // Study answer buttons
    const studyAgainBtn = document.getElementById('study-again');
    if (studyAgainBtn) {
        studyAgainBtn.addEventListener('click', () => answerStudyCard('again'));
    }
    
    const studyHardBtn = document.getElementById('study-hard');
    if (studyHardBtn) {
        studyHardBtn.addEventListener('click', () => answerStudyCard('hard'));
    }
    
    const studyGoodBtn = document.getElementById('study-good');
    if (studyGoodBtn) {
        studyGoodBtn.addEventListener('click', () => answerStudyCard('good'));
    }
    
    const studyEasyBtn = document.getElementById('study-easy');
    if (studyEasyBtn) {
        studyEasyBtn.addEventListener('click', () => answerStudyCard('easy'));
    }
    
    // Exit study mode button
    const exitStudyBtn = document.getElementById('exit-study-mode');
    if (exitStudyBtn) {
        exitStudyBtn.addEventListener('click', exitStudyMode);
    }
    
    // Return to decks button (study completion)
    const returnToDecksBtn = document.getElementById('return-to-decks');
    if (returnToDecksBtn) {
        returnToDecksBtn.addEventListener('click', exitStudyMode);
    }
    
    // Edit card button
    const editCardButton = document.getElementById('edit-card-button');
    if (editCardButton) {
        editCardButton.addEventListener('click', () => {
            if (currentPageId && currentCardIndex !== null) {
                openCardEditor(currentPageId, currentCardIndex);
            }
        });
    }
}

function setupAutoAdvance() {
    const autoAdvanceCheckbox = document.getElementById('auto-advance');
    if (autoAdvanceCheckbox) {
        autoAdvanceCheckbox.addEventListener('change', function() {
            if (this.checked) {
                startAutoAdvance();
            } else {
                stopAutoAdvance();
            }
        });
    }
}

function setupShareButton() {
    const shareButton = document.getElementById('share-link');
    if (shareButton) {
        shareButton.addEventListener('click', function() {
            if (!currentPageId) return;
            
            const shareableUrl = getShareableUrl(currentPageId);
            navigator.clipboard.writeText(shareableUrl)
                .then(() => showNotification('Link copied to clipboard!'))
                .catch(() => showNotification('Failed to copy link', true));
        });
    }
}

function setupSettingsPanel() {
    // Night mode toggle
    const nightModeToggle = document.getElementById('night-mode-toggle');
    if (nightModeToggle) {
        nightModeToggle.checked = userSettings.nightMode;
        nightModeToggle.addEventListener('change', function() {
            userSettings.nightMode = this.checked;
            saveUserSettings();
            applyUserSettings();
        });
    }
    
    // New cards per day input
    const newCardsInput = document.getElementById('new-cards-per-day');
    if (newCardsInput) {
        newCardsInput.value = userSettings.newCardsPerDay;
        newCardsInput.addEventListener('change', function() {
            const value = parseInt(this.value);
            if (value > 0) {
                userSettings.newCardsPerDay = value;
                saveUserSettings();
            }
        });
    }
    
    // Reviews per day input
    const reviewsInput = document.getElementById('reviews-per-day');
    if (reviewsInput) {
        reviewsInput.value = userSettings.reviewsPerDay;
        reviewsInput.addEventListener('change', function() {
            const value = parseInt(this.value);
            if (value > 0) {
                userSettings.reviewsPerDay = value;
                saveUserSettings();
            }
        });
    }
    
    // Spaced repetition toggle
    const spacedRepToggle = document.getElementById('spaced-rep-toggle');
    if (spacedRepToggle) {
        spacedRepToggle.checked = userSettings.useSpacedRepetition;
        spacedRepToggle.addEventListener('change', function() {
            userSettings.useSpacedRepetition = this.checked;
            saveUserSettings();
            
            // Show/hide spaced rep buttons based on setting
            toggleSpacedRepetitionUI();
        });
    }
    
    // Autoplay audio toggle
    const autoplayToggle = document.getElementById('autoplay-toggle');
    if (autoplayToggle) {
        autoplayToggle.checked = userSettings.autoplayAudio;
        autoplayToggle.addEventListener('change', function() {
            userSettings.autoplayAudio = this.checked;
            saveUserSettings();
        });
    }
    
    // Card order selects
    const newCardOrderSelect = document.getElementById('new-card-order');
    if (newCardOrderSelect) {
        newCardOrderSelect.value = userSettings.cardOrderNew;
        newCardOrderSelect.addEventListener('change', function() {
            userSettings.cardOrderNew = this.value;
            saveUserSettings();
        });
    }
    
    const reviewCardOrderSelect = document.getElementById('review-card-order');
    if (reviewCardOrderSelect) {
        reviewCardOrderSelect.value = userSettings.cardOrderReview;
        reviewCardOrderSelect.addEventListener('change', function() {
            userSettings.cardOrderReview = this.value;
            saveUserSettings();
        });
    }
    
    // Reset settings button
    const resetSettingsBtn = document.getElementById('reset-settings');
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', function() {
            if (confirm('Reset all settings to defaults?')) {
                userSettings = {
                    newCardsPerDay: 20,
                    reviewsPerDay: 100,
                    showImages: true,
                    useSpacedRepetition: true,
                    autoplayAudio: false,
                    nightMode: false,
                    cardOrderNew: 'due',
                    cardOrderReview: 'due'
                };
                saveUserSettings();
                applyUserSettings();
                showNotification('Settings reset to defaults');
            }
        });
    }
}

function toggleSpacedRepetitionUI() {
    const answerButtonsContainer = document.getElementById('answer-buttons-container');
    const standardButtonsContainer = document.getElementById('standard-buttons-container');
    
    if (userSettings.useSpacedRepetition) {
        if (answerButtonsContainer) answerButtonsContainer.style.display = 'flex';
        if (standardButtonsContainer) standardButtonsContainer.style.display = 'none';
    } else {
        if (answerButtonsContainer) answerButtonsContainer.style.display = 'none';
        if (standardButtonsContainer) standardButtonsContainer.style.display = 'flex';
    }
}

function setupTagsFilter() {
    // Populate tag list for filter
    const tagFilterContainer = document.getElementById('tag-filter-container');
    if (tagFilterContainer) {
        updateTagFilterList();
        
        // Tag filter clear button
        const clearTagsButton = document.getElementById('clear-tags-filter');
        if (clearTagsButton) {
            clearTagsButton.addEventListener('click', () => {
                activeFilters.tags = [];
                updateTagFilterDisplay();
                filterPages();
            });
        }
    }
    
    // Tag select dropdown
    const tagSelect = document.getElementById('tag-filter');
    if (tagSelect) {
        tagSelect.addEventListener('change', function() {
            const selectedTag = this.value;
            if (selectedTag && !activeFilters.tags.includes(selectedTag)) {
                activeFilters.tags.push(selectedTag);
                this.value = ''; // Reset select
                updateTagFilterDisplay();
                filterPages();
            }
        });
    }
    
    // Difficulty filter
    const difficultyFilter = document.getElementById('difficulty-filter');
    if (difficultyFilter) {
        difficultyFilter.addEventListener('change', function() {
            activeFilters.difficulty = this.value;
            filterPages();
        });
    }
    
    // Status filter
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', function() {
            activeFilters.status = this.value;
            filterPages();
        });
    }
}

function updateTagFilterList() {
    // Get all tags from all cards
    tagList = [];
    
    Object.values(allFlashcards).forEach(page => {
        if (!page.cards) return;
        
        page.cards.forEach(card => {
            if (card && card.tags && Array.isArray(card.tags)) {
                card.tags.forEach(tag => {
                    if (!tagList.includes(tag)) {
                        tagList.push(tag);
                    }
                });
            }
        });
    });
    
    // Sort tags alphabetically
    tagList.sort();
    
    // Update tag filter dropdown
    const tagSelect = document.getElementById('tag-filter');
    if (tagSelect) {
        tagSelect.innerHTML = '<option value="">Filter by tag...</option>';
        
        tagList.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.textContent = tag;
            tagSelect.appendChild(option);
        });
    }
}

function updateTagFilterDisplay() {
    const activeTagsContainer = document.getElementById('active-tags-container');
    if (!activeTagsContainer) return;
    
    activeTagsContainer.innerHTML = '';
    
    activeFilters.tags.forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.className = 'badge bg-secondary me-1 mb-1 tag-item';
        tagElement.textContent = tag;
        
        // Add remove button
        const removeButton = document.createElement('span');
        removeButton.className = 'tag-remove ms-1';
        removeButton.innerHTML = '&times;';
        removeButton.addEventListener('click', () => {
            activeFilters.tags = activeFilters.tags.filter(t => t !== tag);
            updateTagFilterDisplay();
            filterPages();
        });
        
        tagElement.appendChild(removeButton);
        activeTagsContainer.appendChild(tagElement);
    });
}

function setupStudyOptions() {
    // Custom study button
    const customStudyButton = document.getElementById('custom-study-button');
    if (customStudyButton) {
        customStudyButton.addEventListener('click', () => {
            const customStudyModal = new bootstrap.Modal(document.getElementById('custom-study-modal'));
            customStudyModal.show();
        });
    }
    
    // Study now button
    const studyNowButton = document.getElementById('study-now-button');
    if (studyNowButton) {
        studyNowButton.addEventListener('click', () => {
            // Start study with default options (all due cards)
            startStudySession(true, true, userSettings.reviewsPerDay + userSettings.newCardsPerDay, []);
        });
    }
    
    // Start custom study button
    const startCustomStudyBtn = document.getElementById('start-custom-study');
    if (startCustomStudyBtn) {
        startCustomStudyBtn.addEventListener('click', () => {
            // Get options from modal
            const newCardsOption = document.getElementById('custom-study-new');
            const reviewCardsOption = document.getElementById('custom-study-review');
            const limitInput = document.getElementById('custom-study-limit');
            const tagsInput = document.getElementById('custom-study-tags');
            
            const includeNew = newCardsOption ? newCardsOption.checked : true;
            const includeDue = reviewCardsOption ? reviewCardsOption.checked : true;
            const limit = limitInput && limitInput.value ? parseInt(limitInput.value) : 50;
            const tags = tagsInput && tagsInput.value ? 
                tagsInput.value.split(',').map(t => t.trim()).filter(t => t) : [];
            
            // Start study with custom options
            startStudySession(includeDue, includeNew, limit, tags);
            
            // Hide modal
            const customStudyModal = bootstrap.Modal.getInstance(document.getElementById('custom-study-modal'));
            if (customStudyModal) {
                customStudyModal.hide();
            }
        });
    }
}

function setupBatchEditing() {
    // Batch edit button
    const batchEditButton = document.getElementById('batch-edit-button');
    if (batchEditButton) {
        batchEditButton.addEventListener('click', () => {
            // Show batch edit modal
            const batchEditModal = new bootstrap.Modal(document.getElementById('batch-edit-modal'));
            batchEditModal.show();
            enableBatchEditMode();
        });
    }
    
    // Apply batch edits button
    const applyBatchEditsButton = document.getElementById('apply-batch-edits');
    if (applyBatchEditsButton) {
        applyBatchEditsButton.addEventListener('click', applyBatchEdits);
    }
    
    // Select all button
    const selectAllButton = document.getElementById('select-all-batch');
    if (selectAllButton) {
        selectAllButton.addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('.batch-select');
            checkboxes.forEach(checkbox => checkbox.checked = true);
        });
    }
    
    // Deselect all button
    const deselectAllButton = document.getElementById('deselect-all-batch');
    if (deselectAllButton) {
        deselectAllButton.addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('.batch-select');
            checkboxes.forEach(checkbox => checkbox.checked = false);
        });
    }
}

function setupCardEditor() {
    // Save card edits button
    const saveCardEditsBtn = document.getElementById('save-card-edits');
    if (saveCardEditsBtn) {
        saveCardEditsBtn.addEventListener('click', saveCardEdits);
    }
    
    // Cancel card edits button
    const cancelCardEditsBtn = document.getElementById('cancel-card-edits');
    if (cancelCardEditsBtn) {
        cancelCardEditsBtn.addEventListener('click', () => {
            closeCardEditor();
        });
    }
}

function setupModals() {
    // Modals are auto-initialized by Bootstrap 5
}

// Handle keyboard shortcuts
function handleKeyPress(e) {
    // Skip if in any input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // Skip if modifiers are pressed
    if (e.ctrlKey || e.altKey || e.metaKey) {
        return;
    }
    
    // Check if in study mode
    if (currentView === 'study') {
        handleStudyModeKeyPress(e);
        return;
    }
    
    // Only process if in cards view and we have cards loaded
    if (currentView !== 'cards' || !currentPageId || !allFlashcards[currentPageId]) return;
    
    switch(e.key) {
        case 'ArrowLeft':
            showPreviousCard();
            e.preventDefault();
            break;
        case 'ArrowRight':
            showNextCard();
            e.preventDefault();
            break;
        case ' ':
            toggleAnswer();
            e.preventDefault(); // Prevent scrolling
            break;
        case '1':
            if (userSettings.useSpacedRepetition && document.getElementById('answer-again')) {
                answerCard('again');
                e.preventDefault();
            }
            break;
        case '2':
            if (userSettings.useSpacedRepetition && document.getElementById('answer-hard')) {
                answerCard('hard');
                e.preventDefault();
            }
            break;
        case '3':
            if (userSettings.useSpacedRepetition && document.getElementById('answer-good')) {
                answerCard('good');
                e.preventDefault();
            }
            break;
        case '4':
            if (userSettings.useSpacedRepetition && document.getElementById('answer-easy')) {
                answerCard('easy');
                e.preventDefault();
            }
            break;
    }
}

function handleStudyModeKeyPress(e) {
    // Get study mode elements
    const answerHidden = document.getElementById('study-answer').classList.contains('hidden');
    const showAnswerBtn = document.getElementById('study-show-answer');
    
    switch(e.key) {
        case ' ':
            if (answerHidden && showAnswerBtn) {
                showStudyAnswer();
            } else {
                // If answer is showing, pressing space should go to next card with "good" rating
                answerStudyCard('good');
            }
            e.preventDefault();
            break;
        case '1':
            if (!answerHidden) {
                answerStudyCard('again');
                e.preventDefault();
            }
            break;
        case '2':
            if (!answerHidden) {
                answerStudyCard('hard');
                e.preventDefault();
            }
            break;
        case '3':
            if (!answerHidden) {
                answerStudyCard('good');
                e.preventDefault();
            }
            break;
        case '4':
            if (!answerHidden) {
                answerStudyCard('easy');
                e.preventDefault();
            }
            break;
        case 'Escape':
            exitStudyMode();
            e.preventDefault();
            break;
    }
}

// Load user data (notebooks and flashcards)
async function loadUserData() {
    console.log('Loading user data...');
    try {
        // Show loading indicator
        showLoading('Loading notebooks...');
        
        // Load notebooks first
        await loadNotebooks();
        
        // Check if we have cached flashcards in localStorage
        const cachedFlashcards = loadFlashcardsFromLocalStorage();
        if (cachedFlashcards) {
            console.log('Using cached flashcards from localStorage');
            allFlashcards = cachedFlashcards;
            
            // Update UI with cached data
            updateTagFilterList();
            renderPagesList();
        }
        
        // Check for pending saves from offline mode
        const pendingSavesJson = localStorage.getItem('pendingSaves');
        if (pendingSavesJson) {
            try {
                pendingSaves = JSON.parse(pendingSavesJson);
                if (navigator.onLine && pendingSaves.length > 0) {
                    processPendingSaves();
                }
            } catch (e) {
                console.error('Error loading pending saves:', e);
                pendingSaves = [];
            }
        }
        
        // Then load all flashcards from server
        await loadFlashcards();
        
        // Load last selection from local storage
        loadLastSelection();
        
        // Hide loading indicator
        hideLoading();
        
        console.log('User data loaded successfully');
    } catch (error) {
        console.error('Error loading user data:', error);
        hideLoading();
        
        // If unauthorized, redirect to login
        if (error.status === 401) {
            window.location.href = '/auth/signin';
        } else {
            showNotification('Error loading your data. Please try again.', true);
        }
    }
}

// Load notebooks from API
async function loadNotebooks() {
    console.log('Loading notebooks...');
    try {
        const response = await fetch('/api/notebooks');
        
        // Handle authentication errors
        if (response.status === 401) {
            window.location.href = '/auth/signin';
            throw { status: 401, message: 'Authentication required' };
        }
        
        if (!response.ok) {
            throw new Error(`Failed to fetch notebooks: ${response.status}`);
        }
        
        const notebooks = await response.json();
        console.log(`Loaded ${notebooks.length} notebooks`);
        
        // Populate notebook dropdown
        const notebookSelect = document.getElementById('notebook-select');
        if (notebookSelect) {
            notebookSelect.innerHTML = '<option value="">Select a notebook</option>';
            
            notebooks.forEach(notebook => {
                const option = document.createElement('option');
                option.value = notebook.id;
                option.textContent = notebook.displayName;
                notebookSelect.appendChild(option);
            });
        }
        
        return notebooks;
    } catch (error) {
        console.error('Error loading notebooks:', error);
        throw error;
    }
}

// Load sections for selected notebook
async function loadSections(notebookId) {
    console.log(`Loading sections for notebook: ${notebookId}`);
    try {
        if (!notebookId) return;
        
        showLoading('Loading sections...');
        
        const response = await fetch(`/api/notebooks/${notebookId}/sections`);
        
        if (response.status === 401) {
            window.location.href = '/auth/signin';
            throw { status: 401, message: 'Authentication required' };
        }
        
        if (!response.ok) {
            throw new Error(`Failed to fetch sections: ${response.status}`);
        }
        
        const sections = await response.json();
        console.log(`Loaded ${sections.length} sections`);
        
        // Populate sections dropdown
        const sectionSelect = document.getElementById('section-select');
        if (sectionSelect) {
            sectionSelect.innerHTML = '<option value="">Select a section</option>';
            
            sections.forEach(section => {
                const option = document.createElement('option');
                option.value = section.id;
                option.textContent = section.displayName;
                sectionSelect.appendChild(option);
            });
        }
        
        hideLoading();
        return sections;
    } catch (error) {
        console.error('Error loading sections:', error);
        hideLoading();
        throw error;
    }
}

// Load all flashcards
async function loadFlashcards() {
    console.log('Loading flashcards...');
    try {
        showLoading('Loading flashcards...');
        
        const response = await fetch('/api/flashcards');
        
        if (response.status === 401) {
            window.location.href = '/auth/signin';
            throw { status: 401, message: 'Authentication required' };
        }
        
        if (!response.ok) {
            throw new Error(`Failed to fetch flashcards: ${response.status}`);
        }
        
        // Get flashcards from server
        const serverFlashcards = await response.json();
        const flashcardCount = Object.keys(serverFlashcards).length;
        console.log(`Loaded flashcards for ${flashcardCount} pages from server`);
        
        // Merge with existing flashcards to preserve study data
        if (Object.keys(allFlashcards).length > 0) {
            // For each page from the server
            Object.entries(serverFlashcards).forEach(([pageId, pageData]) => {
                // If we already have this page, merge cards
                if (allFlashcards[pageId]) {
                    // Update page title and last updated
                    allFlashcards[pageId].pageTitle = pageData.pageTitle;
                    allFlashcards[pageId].lastUpdated = pageData.lastUpdated;
                    
                    // Store existing cards by question for fast lookup
                    const existingCardsByQuestion = {};
                    allFlashcards[pageId].cards.forEach((card, index) => {
                        if (card && card.question) {
                            existingCardsByQuestion[card.question] = { card, index };
                        }
                    });
                    
                    // Process each server card
                    const updatedCards = [];
                    pageData.cards.forEach(serverCard => {
                        // Try to find matching card in local data
                        const existingData = existingCardsByQuestion[serverCard.question];
                        
                        if (existingData) {
                            // Preserve study data with priority to server data if available
                            serverCard.interval = serverCard.interval !== undefined ? serverCard.interval : existingData.card.interval || 0;
                            serverCard.ease = serverCard.ease !== undefined ? serverCard.ease : existingData.card.ease || EASE_FACTOR_DEFAULT;
                            serverCard.due = serverCard.due !== undefined ? serverCard.due : existingData.card.due || null;
                            serverCard.reviewCount = serverCard.reviewCount !== undefined ? serverCard.reviewCount : existingData.card.reviewCount || 0;
                            serverCard.tags = serverCard.tags || existingData.card.tags || [];
                            serverCard.suspended = serverCard.suspended !== undefined ? serverCard.suspended : existingData.card.suspended || false;
                        } else {
                            // This is a new card, initialize study data
                            serverCard.interval = serverCard.interval || 0;
                            serverCard.ease = serverCard.ease || EASE_FACTOR_DEFAULT;
                            serverCard.due = serverCard.due || null;
                            serverCard.reviewCount = serverCard.reviewCount || 0;
                            serverCard.tags = serverCard.tags || [];
                            serverCard.suspended = serverCard.suspended || false;
                        }
                        
                        updatedCards.push(serverCard);
                    });
                    
                    // Replace cards array with updated version
                    allFlashcards[pageId].cards = updatedCards;
                    
                } else {
                    // This is a new page, add it with initialized study data
                    pageData.cards.forEach(card => {
                        card.interval = card.interval || 0;
                        card.ease = card.ease || EASE_FACTOR_DEFAULT;
                        card.due = card.due || null;
                        card.reviewCount = card.reviewCount || 0;
                        card.tags = card.tags || [];
                        card.suspended = card.suspended || false;
                    });
                    
                    allFlashcards[pageId] = pageData;
                }
            });
        } else {
            // First time loading, initialize all cards with study data
            Object.entries(serverFlashcards).forEach(([pageId, pageData]) => {
                if (pageData.cards) {
                    pageData.cards.forEach(card => {
                        card.interval = card.interval || 0;
                        card.ease = card.ease || EASE_FACTOR_DEFAULT;
                        card.due = card.due || null;
                        card.reviewCount = card.reviewCount || 0;
                        card.tags = card.tags || [];
                        card.suspended = card.suspended || false;
                    });
                } else {
                    // Ensure cards array exists
                    pageData.cards = [];
                }
            });
            
            allFlashcards = serverFlashcards;
        }
        
        // Save merged flashcards to localStorage
        saveFlashcardsToLocalStorage();
        
        // Update tag list
        updateTagFilterList();
        
        // Update pages list
        renderPagesList();
        
        // Update pages count badge
        const pagesCount = document.getElementById('pages-count');
        if (pagesCount) {
            pagesCount.textContent = Object.keys(allFlashcards).length;
        }
        
        // Update due counts
        updateDueCounts();
        
        // Update stats display
        updateStatsDisplay();
        
        // Update heatmap
        updateHeatmap();
        
        hideLoading();
    } catch (error) {
        console.error('Error loading flashcards:', error);
        hideLoading();
        throw error;
    }
}

function renderPagesList(filteredPageIds) {
    console.log('Rendering pages list with updated counts');
    
    // Clear any cached counts
    Object.keys(allFlashcards).forEach(pageId => {
        // Force count recalculation for each deck
        if (allFlashcards[pageId]._cachedCounts) {
            delete allFlashcards[pageId]._cachedCounts;
        }
    });
    
    // Rest of the function remains unchanged
    const pagesList = document.getElementById('pages-list');
    if (!pagesList) return;
    
    // Clear the list
    pagesList.innerHTML = '';
    
    // Get page IDs - either filtered or all
    const pageIds = filteredPageIds || Object.keys(allFlashcards);
    
    // Check if we have any pages
    if (pageIds.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'list-group-item text-center';
        emptyItem.innerHTML = filteredPageIds 
            ? '<i class="bi bi-search me-2"></i>No matching flashcards found.' 
            : '<i class="bi bi-info-circle me-2"></i>No flashcards yet. Sync to create them.';
        pagesList.appendChild(emptyItem);
        return;
    }
    
    // Sort pages by title
    pageIds.sort((a, b) => {
        const titleA = allFlashcards[a]?.pageTitle || '';
        const titleB = allFlashcards[b]?.pageTitle || '';
        return titleA.localeCompare(titleB);
    });
    
    // Add each page to the list with numbered index
    pageIds.forEach((pageId, index) => {
        if (!allFlashcards[pageId]) return;
        
        const pageData = allFlashcards[pageId];
        if (!pageData.cards) pageData.cards = [];
        
        // Count cards by status
        let dueCount = 0;
        let newCount = 0;
        let inProgressCount = 0;
        const today = new Date();
        
        pageData.cards.forEach(card => {
            if (card.suspended) return; // Skip suspended cards
            
            if (!card.due) {
                // New card
                newCount++;
            } else if (new Date(card.due) <= today) {
                // Due card
                dueCount++;
            } else if (card.reviewCount && card.reviewCount > 0) {
                // In progress (reviewed but not due)
                inProgressCount++;
            }
        });
        
        const totalCards = pageData.cards.length;
        
        // Create list item
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item deck-item d-flex justify-content-between align-items-center';
        listItem.dataset.pageId = pageId;
        
        // Highlight current page
        if (pageId === currentPageId) {
            listItem.classList.add('active');
        }
        
        // Create deck index and title
        const titleSection = document.createElement('div');
        titleSection.className = 'deck-title';
        titleSection.innerHTML = `
            <span class="deck-index">${index + 1}.</span>
            <span class="deck-name">${pageData.pageTitle}</span>
        `;
        
        // Create card counts section (Anki style)
        const countsSection = document.createElement('div');
        countsSection.className = 'deck-counts';
        
        // Only show counts if we have cards
        if (totalCards > 0) {
            countsSection.innerHTML = `
                <span class="count new" title="New cards">${newCount}</span>
                <span class="count due" title="Cards due to review">${dueCount}</span>
                <span class="count learned" title="Cards in progress">${inProgressCount}</span>
            `;
        } else {
            countsSection.innerHTML = `<span class="count empty">0</span>`;
        }
        
        // Add elements to list item
        listItem.appendChild(titleSection);
        listItem.appendChild(countsSection);
        
        // Add click handler
        listItem.addEventListener('click', () => selectPage(pageId));
        
        // Add to list
        pagesList.appendChild(listItem);
    });
    
    // Show count of results
    const resultCount = document.createElement('div');
    resultCount.className = 'text-muted small mt-2';
    resultCount.textContent = `Showing ${pageIds.length} decks`;
    
    // Remove any existing count
    const existingCount = document.querySelector('.card-body .text-muted.small.mt-2');
    if (existingCount) {
        existingCount.remove();
    }
    
    // Add count to container
    const container = pagesList.closest('.card-body');
    if (container) {
        container.appendChild(resultCount);
    }
    
    // Ensure everything is visible
    setTimeout(() => {
        // Force a browser reflow to update UI
        const forceReflow = document.body.offsetHeight;
    }, 100);
}


// Filter pages by search term and other filters
function filterPages(searchTerm) {
    let filteredPageIds = Object.keys(allFlashcards);
    
    // Apply search term filter
    if (searchTerm) {
        searchTerm = searchTerm.toLowerCase();
        
        filteredPageIds = filteredPageIds.filter(pageId => {
            const pageData = allFlashcards[pageId];
            
            // Check if title matches
            if (pageData.pageTitle.toLowerCase().includes(searchTerm)) {
                return true;
            }
            
            // Check if any card content matches
            return pageData.cards.some(card => 
                card.question.toLowerCase().includes(searchTerm) || 
                card.answer.toLowerCase().includes(searchTerm)
            );
        });
    }
    
    // Apply tag filters
    if (activeFilters.tags.length > 0) {
        filteredPageIds = filteredPageIds.filter(pageId => {
            const pageData = allFlashcards[pageId];
            
            // Check if any card has all the required tags
            return pageData.cards.some(card => {
                if (!card.tags) return false;
                
                // Check if card has all required tags
                return activeFilters.tags.every(tag => card.tags.includes(tag));
            });
        });
    }
    
    // Apply difficulty filter
    if (activeFilters.difficulty !== 'all') {
        filteredPageIds = filteredPageIds.filter(pageId => {
            const pageData = allFlashcards[pageId];
            
            // Filter based on difficulty (using ease factor as a proxy)
            return pageData.cards.some(card => {
                if (!card.ease) return false;
                
                switch (activeFilters.difficulty) {
                    case 'easy':
                        return card.ease > 2.5;
                    case 'medium':
                        return card.ease >= 2.0 && card.ease <= 2.5;
                    case 'hard':
                        return card.ease < 2.0;
                    default:
                        return true;
                }
            });
        });
    }
    
    // Apply status filter
    if (activeFilters.status !== 'all') {
        const today = new Date();
        
        filteredPageIds = filteredPageIds.filter(pageId => {
            const pageData = allFlashcards[pageId];
            
            return pageData.cards.some(card => {
                if (card.suspended) return false;
                
                switch (activeFilters.status) {
                    case 'due':
                        return card.due && new Date(card.due) <= today;
                    case 'new':
                        return !card.due;
                    case 'learned':
                        return card.reviewCount && card.reviewCount > 0;
                    default:
                        return true;
                }
            });
        });
    }
    
    renderPagesList(filteredPageIds);
}

// Select a page and display its flashcards
function selectPage(pageId) {
    console.log(`Selecting page: ${pageId}`);
    
    if (!allFlashcards[pageId]) {
        console.error(`Page ${pageId} not found`);
        return;
    }
    
    // Update current page and reset to first card
    currentPageId = pageId;
    currentCardIndex = 0;
    
    // Highlight selected page in list
    const pageItems = document.querySelectorAll('#pages-list li');
    pageItems.forEach(item => item.classList.remove('active'));
    
    const selectedItem = document.querySelector(`#pages-list li[data-page-id="${pageId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('active');
        selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    // Update page title
    const pageTitleEl = document.getElementById('current-page-title');
    if (pageTitleEl) {
        pageTitleEl.textContent = allFlashcards[pageId].pageTitle;
    }
    
    // Show/hide auto-advance container
    const autoAdvanceContainer = document.getElementById('auto-advance-container');
    if (autoAdvanceContainer) {
        const hasCards = allFlashcards[pageId].cards.length > 0;
        autoAdvanceContainer.style.display = hasCards ? 'block' : 'none';
    }
    
    // Display first card
    displayCurrentCard();
    
    // Switch to cards view
    showView('cards');
    
    // Update URL for direct access
    const url = new URL(window.location);
    url.searchParams.set('page', pageId);
    window.history.replaceState({}, '', url);
}

// Display the current flashcard
function displayCurrentCard() {
    if (!currentPageId || !allFlashcards[currentPageId]) return;
    
    const pageData = allFlashcards[currentPageId];
    if (!pageData.cards) pageData.cards = [];
    const cards = pageData.cards;
    
    // Get DOM elements
    const questionEl = document.getElementById('question');
    const answerEl = document.getElementById('answer');
    const cardCounter = document.getElementById('card-counter');
    const toggleButton = document.getElementById('toggle-button');
    const prevButton = document.getElementById('prev-button');
    const nextButton = document.getElementById('next-button');
    const cardTags = document.getElementById('card-tags');
    const cardDueDate = document.getElementById('card-due-date');
    const answerButtonsContainer = document.getElementById('answer-buttons-container');
    
    // Always hide the answer when displaying a card
    if (answerEl) {
        answerEl.classList.add('hidden');
    }
    
    // Always hide answer buttons when displaying a card
    if (answerButtonsContainer) {
        answerButtonsContainer.style.display = 'none';
    }
    
    // Reset toggle button text
    if (toggleButton) {
        toggleButton.innerHTML = '<i class="bi bi-eye me-1"></i> Show Answer';
    }
    
    // Check if we have cards
    if (cards.length === 0) {
        if (questionEl) questionEl.innerHTML = '<i class="bi bi-info-circle me-2"></i>No flashcards available for this page';
        if (answerEl) {
            answerEl.textContent = '';
            answerEl.classList.add('hidden');
        }
        if (cardCounter) cardCounter.textContent = '0/0';
        if (toggleButton) toggleButton.disabled = true;
        if (prevButton) prevButton.disabled = true;
        if (nextButton) nextButton.disabled = true;
        if (cardTags) cardTags.innerHTML = '';
        if (cardDueDate) cardDueDate.style.display = 'none';
        if (answerButtonsContainer) answerButtonsContainer.style.display = 'none';
        
        const editCardButton = document.getElementById('edit-card-button');
        if (editCardButton) editCardButton.style.display = 'none';
        
        return;
    }
    
    // Update card counter
    if (cardCounter) {
        cardCounter.textContent = `${currentCardIndex + 1}/${cards.length}`;
    }
    
    // Get current card
    const card = cards[currentCardIndex];
    
    // Display tags
    if (cardTags) {
        cardTags.innerHTML = '';
        
        if (card.tags && card.tags.length > 0) {
            card.tags.forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'tag-item me-1';
                tagEl.textContent = tag;
                cardTags.appendChild(tagEl);
            });
        }
    }
    
    // Display due date if available
    if (cardDueDate) {
        if (card.due) {
            const dueDate = new Date(card.due);
            const today = new Date();
            
            // Check if due today, overdue, or future
            let dueClass = 'text-muted';
            if (dueDate <= today) {
                dueClass = 'text-danger'; // Overdue or due today
            }
            
            cardDueDate.textContent = `Due: ${formatDate(dueDate)}`;
            cardDueDate.className = dueClass;
            cardDueDate.style.display = 'inline';
        } else {
            cardDueDate.textContent = 'New card';
            cardDueDate.className = 'text-primary';
            cardDueDate.style.display = 'inline';
        }
    }
    
    // Display question
    if (questionEl) {
        questionEl.innerHTML = card.question;
    }
    
    // Hide answer initially
    if (answerEl) {
        answerEl.innerHTML = card.answer;
        answerEl.classList.add('hidden');
    }
    
    // Update button states
    if (toggleButton) {
        toggleButton.disabled = false;
        toggleButton.innerHTML = '<i class="bi bi-eye me-1"></i> Show Answer';
    }
    
    if (prevButton) {
        prevButton.disabled = currentCardIndex === 0;
    }
    
    if (nextButton) {
        nextButton.disabled = currentCardIndex >= cards.length - 1;
    }
    
    // Update spaced repetition buttons
    updateAnswerButtonLabels(card);
    
    // Show/hide buttons based on settings
    toggleSpacedRepetitionUI();
    
    // Play audio if present and autoplay is enabled
    if (userSettings.autoplayAudio && card.audio) {
        const audioElement = document.getElementById('card-audio');
        if (audioElement) {
            audioElement.src = card.audio;
            audioElement.play();
        }
    }
    
    // Enable edit button
    const editCardButton = document.getElementById('edit-card-button');
    if (editCardButton) editCardButton.style.display = 'inline-block';
}

// Update answer button labels based on card interval
function updateAnswerButtonLabels(card) {
    const againBtn = document.getElementById('answer-again');
    const hardBtn = document.getElementById('answer-hard');
    const goodBtn = document.getElementById('answer-good');
    const easyBtn = document.getElementById('answer-easy');
    
    if (!againBtn || !hardBtn || !goodBtn || !easyBtn) return;
    
    // Calculate intervals for each button
    let againInterval = "1d";
    let hardInterval = "2d";
    let goodInterval = "3d";
    let easyInterval = "4d";
    
    if (card.interval) {
        // For cards with existing intervals
        againInterval = "1d";
        hardInterval = Math.max(2, Math.ceil(card.interval * NEW_INTERVAL_HARD)) + "d";
        goodInterval = Math.ceil(card.interval * (card.ease || EASE_FACTOR_DEFAULT)) + "d";
        easyInterval = Math.ceil(card.interval * (card.ease || EASE_FACTOR_DEFAULT) * EASE_MODIFIER_EASY) + "d";
    }
    
    // Update button labels
    const againLabel = againBtn.querySelector('.btn-interval');
    const hardLabel = hardBtn.querySelector('.btn-interval');
    const goodLabel = goodBtn.querySelector('.btn-interval');
    const easyLabel = easyBtn.querySelector('.btn-interval');
    
    if (againLabel) againLabel.textContent = againInterval;
    if (hardLabel) hardLabel.textContent = hardInterval;
    if (goodLabel) goodLabel.textContent = goodInterval;
    if (easyLabel) easyLabel.textContent = easyInterval;
}

// Show next card
function showNextCard() {
    if (!currentPageId || !allFlashcards[currentPageId]) return;
    
    const cards = allFlashcards[currentPageId].cards;
    if (currentCardIndex < cards.length - 1) {
        currentCardIndex++;
        
        // Make sure to hide answer and rating buttons when navigating
        const answerEl = document.getElementById('answer');
        const answerButtonsContainer = document.getElementById('answer-buttons-container');
        
        if (answerEl) {
            answerEl.classList.add('hidden');
        }
        
        if (answerButtonsContainer) {
            answerButtonsContainer.style.display = 'none';
        }
        
        const toggleButton = document.getElementById('toggle-button');
        if (toggleButton) {
            toggleButton.innerHTML = '<i class="bi bi-eye me-1"></i> Show Answer';
        }
        
        displayCurrentCard();
    }
}

// Show previous card
function showPreviousCard() {
    if (currentCardIndex > 0) {
        currentCardIndex--;
        
        // Make sure to hide answer and rating buttons when navigating
        const answerEl = document.getElementById('answer');
        const answerButtonsContainer = document.getElementById('answer-buttons-container');
        
        if (answerEl) {
            answerEl.classList.add('hidden');
        }
        
        if (answerButtonsContainer) {
            answerButtonsContainer.style.display = 'none';
        }
        
        const toggleButton = document.getElementById('toggle-button');
        if (toggleButton) {
            toggleButton.innerHTML = '<i class="bi bi-eye me-1"></i> Show Answer';
        }
        
        displayCurrentCard();
    }
}

// Toggle answer visibility
function toggleAnswer() {
    const answerEl = document.getElementById('answer');
    const toggleButton = document.getElementById('toggle-button');
    const answerButtonsContainer = document.getElementById('answer-buttons-container');
    
    if (!answerEl || !toggleButton) return;
    
    if (answerEl.classList.contains('hidden')) {
        // Show answer
        answerEl.classList.remove('hidden');
        toggleButton.innerHTML = '<i class="bi bi-eye-slash me-1"></i> Hide Answer';
        
        // Show answer buttons if using spaced repetition
        if (userSettings.useSpacedRepetition && answerButtonsContainer) {
            answerButtonsContainer.style.display = 'flex';
        }
    } else {
        // Hide answer
        answerEl.classList.add('hidden');
        toggleButton.innerHTML = '<i class="bi bi-eye me-1"></i> Show Answer';
        
        // Hide answer buttons
        if (answerButtonsContainer) {
            answerButtonsContainer.style.display = 'none';
        }
    }
}

// Answer current card (spaced repetition)
function answerCard(rating) {
    // Get current card
    if (!currentPageId || !allFlashcards[currentPageId]) return;
    
    const cards = allFlashcards[currentPageId].cards;
    if (!cards || currentCardIndex >= cards.length) return;
    
    const card = cards[currentCardIndex];
    
    // Apply spaced repetition algorithm
    applySpacedRepetition(card, rating);
    
    // Record review
    recordCardReview(currentCardIndex, currentPageId, rating);
    
    // Save changes locally
    saveFlashcardsToLocalStorage();
    
    // Save to server
    saveFlashcardsToServer();
    
    // Hide answer and rating buttons before advancing
    const answerEl = document.getElementById('answer');
    const answerButtonsContainer = document.getElementById('answer-buttons-container');
    
    if (answerEl) {
        answerEl.classList.add('hidden');
    }
    
    if (answerButtonsContainer) {
        answerButtonsContainer.style.display = 'none';
    }
    
    // Show next card or loop to beginning if at end
    if (currentCardIndex < cards.length - 1) {
        currentCardIndex++;
        displayCurrentCard();
    } else {
        // Reset to first card if at end
        currentCardIndex = 0;
        displayCurrentCard();
        
        // Show completion message
        showNotification('Deck complete! Starting over from the beginning.');
    }
    
    // Reset toggle button text
    const toggleButton = document.getElementById('toggle-button');
    if (toggleButton) {
        toggleButton.innerHTML = '<i class="bi bi-eye me-1"></i> Show Answer';
    }
    
    // Update due counts
    updateDueCounts();
}

// Start auto-advance timer
function startAutoAdvance() {
    // Stop any existing timer
    stopAutoAdvance();
    
    // Get delay from select element
    const delayEl = document.getElementById('auto-advance-delay');
    const delay = parseInt(delayEl?.value || 7) * 1000;
    
    // Start timer
    autoAdvanceTimer = setInterval(() => {
        const answerEl = document.getElementById('answer');
        
        if (!answerEl) return;
        
        if (answerEl.classList.contains('hidden')) {
            // If answer is hidden, show it
            toggleAnswer();
        } else {
            // If answer is showing, go to next card or answer with 'good'
            if (userSettings.useSpacedRepetition) {
                answerCard('good');
            } else {
                const nextButton = document.getElementById('next-button');
                
                if (nextButton && !nextButton.disabled) {
                    showNextCard();
                    // Hide answer for next card
                    answerEl.classList.add('hidden');
                    const toggleButton = document.getElementById('toggle-button');
                    if (toggleButton) {
                        toggleButton.innerHTML = '<i class="bi bi-eye me-1"></i> Show Answer';
                    }
                } else {
                    // Reached the end, stop auto-advance
                    stopAutoAdvance();
                    
                    const checkbox = document.getElementById('auto-advance');
                    if (checkbox) checkbox.checked = false;
                }
            }
        }
    }, delay);
}

// Stop auto-advance timer
function stopAutoAdvance() {
    if (autoAdvanceTimer) {
        clearInterval(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
}

// Apply spaced repetition algorithm
function applySpacedRepetition(card, rating) {
    // Initialize card review data if not present
    if (!card.interval) card.interval = 0;
    if (!card.ease) card.ease = EASE_FACTOR_DEFAULT;
    if (!card.reviewCount === undefined) card.reviewCount = 0;
    
    // Update review count
    card.reviewCount++;
    
    // Calculate new interval and ease based on rating
    let newInterval, newEase;
    
    switch (rating) {
        case 'again':
            // Reset interval to 1 day
            newInterval = 1;
            newEase = Math.max(1.3, card.ease - 0.2);
            break;
            
        case 'hard':
            if (card.interval === 0) {
                // First time learning
                newInterval = 1;
            } else {
                // Increase interval but by less than for 'good'
                newInterval = Math.max(2, Math.ceil(card.interval * NEW_INTERVAL_HARD));
            }
            newEase = Math.max(1.3, card.ease * EASE_MODIFIER_HARD);
            break;
            
        case 'good':
            if (card.interval === 0) {
                // First time learning
                newInterval = 1;
            } else if (card.interval === 1) {
                // Second review
                newInterval = 3;
            } else {
                // Subsequent reviews
                newInterval = Math.ceil(card.interval * card.ease * INTERVAL_MODIFIER);
            }
            newEase = card.ease * EASE_MODIFIER_GOOD;
            break;
            
        case 'easy':
            if (card.interval === 0) {
                // First time learning
                newInterval = 3;
            } else if (card.interval === 1) {
                // Second review
                newInterval = 7;
            } else {
                // Subsequent reviews
                newInterval = Math.ceil(card.interval * card.ease * EASE_MODIFIER_EASY * INTERVAL_MODIFIER);
            }
            newEase = card.ease * EASE_MODIFIER_EASY;
            break;
    }
    
    // Apply limits
    newInterval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, newInterval));
    
    // Update card
    card.interval = newInterval;
    card.ease = newEase;
    
    // Calculate due date
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + newInterval);
    card.due = dueDate.toISOString();
}

// Replace or enhance your existing sync-related functions in app.js

// Sync state tracking variables
let syncStartTime = null;
let pagesProcessed = 0;
let cardsGenerated = 0;
let syncLogVisible = false;
let syncProgressInterval = null;

// Perform quick sync (incremental)
async function syncSection(notebookId, sectionId) {
    if (isSyncing) {
        showNotification('Sync already in progress. Please wait.');
        return;
    }
    
    try {
        // Initialize sync UI
        initSyncUI();
        isSyncing = true;
        updateSyncStatus('Starting quick sync...', 'active');
        showSyncProgressBar(true);
        updateSyncProgress(10);
        
        addSyncLogEntry('Starting quick sync for current section');
        
        // Call sync API
        const response = await fetch(`/api/sync/section/${sectionId}`, {
            method: 'POST'
        });
        
        if (response.status === 401) {
            window.location.href = '/auth/signin';
            throw { status: 401, message: 'Authentication required' };
        }
        
        if (!response.ok) {
            throw new Error(`Sync failed: ${response.status}`);
        }
        
        updateSyncProgress(50);
        addSyncLogEntry('Finished API sync, processing results');
        
        const result = await response.json();
        
        // Reload flashcards after successful sync
        if (result.success) {
            updateSyncProgress(75);
            addSyncLogEntry(`Processing ${result.cardsUpdated} flashcards`);
            
            await loadFlashcards();
            updateSyncProgress(100);
            
            // Update stats
            cardsGenerated = result.cardsUpdated;
            updateSyncStats();
            
            addSyncLogEntry(`Sync complete - ${result.cardsUpdated} flashcards updated`, 'success');
            updateSyncStatus(`Sync complete! Updated ${result.cardsUpdated} flashcards.`, 'success');
            showNotification(`Sync complete! Updated ${result.cardsUpdated} flashcards.`);
            
            // Save last sync info
            saveLastSyncInfo(notebookId, sectionId);
        } else {
            updateSyncProgress(100);
            addSyncLogEntry('Sync failed - server reported an error', 'error');
            updateSyncStatus('Sync failed. Please try again.', 'error');
            showNotification('Sync failed. Please try again.', true);
        }
    } catch (error) {
        console.error('Sync error:', error);
        updateSyncProgress(100);
        addSyncLogEntry(`Sync error: ${error.message}`, 'error');
        updateSyncStatus('Failed to sync. Please try again.', 'error');
        showNotification('Failed to sync. Please try again.', true);
    } finally {
        // Clean up
        isSyncing = false;
        setTimeout(() => {
            showSyncProgressBar(false);
            clearSyncProgressInterval();
        }, 1500);
    }
}

// Perform full sync
async function fullSync(notebookId, sectionId) {
    if (isSyncing) {
        showNotification('Sync already in progress. Please wait.');
        return;
    }
    
    // Confirm with user
    if (!confirm('Full sync may take several minutes for large note collections. Continue?')) {
        return;
    }
    
    try {
        // Initialize sync UI
        initSyncUI();
        isSyncing = true;
        updateSyncStatus('Starting full sync...', 'active');
        showSyncProgressBar(true);
        updateSyncProgress(5);
        
        addSyncLogEntry(`Starting full sync for notebook "${getNotebookName(notebookId)}"`);
        
        // Start a polling mechanism to check sync status from the server
        startSyncStatusPolling(sectionId);
        
        // Call full sync API
        const response = await fetch(`/api/sync/full/${notebookId}/${sectionId}`, {
            method: 'POST'
        });
        
        if (response.status === 401) {
            window.location.href = '/auth/signin';
            throw { status: 401, message: 'Authentication required' };
        }
        
        if (!response.ok) {
            throw new Error(`Full sync failed: ${response.status}`);
        }
        
        updateSyncProgress(80);
        addSyncLogEntry('API sync completed, processing results');
        
        const result = await response.json();
        
        // Reload flashcards after successful sync
        if (result.success) {
            updateSyncProgress(90);
            addSyncLogEntry(`Processing ${result.cardsUpdated} flashcards`);
            
            await loadFlashcards();
            updateSyncProgress(100);
            
            // Update stats
            cardsGenerated = result.cardsUpdated;
            updateSyncStats();
            
            addSyncLogEntry(`Sync complete - ${result.cardsUpdated} flashcards created`, 'success');
            updateSyncStatus(`Sync complete! Created ${result.cardsUpdated} flashcards.`, 'success');
            showNotification(`Full sync complete! Created ${result.cardsUpdated} flashcards.`);
            
            // Save last sync info
            saveLastSyncInfo(notebookId, sectionId);
        } else {
            updateSyncProgress(100);
            addSyncLogEntry('Sync failed - server reported an error', 'error');
            updateSyncStatus('Full sync failed. Please try again.', 'error');
            showNotification('Full sync failed. Please try again.', true);
        }
    } catch (error) {
        console.error('Full sync error:', error);
        updateSyncProgress(100);
        addSyncLogEntry(`Sync error: ${error.message}`, 'error');
        updateSyncStatus('Failed to perform full sync. Please try again.', 'error');
        showNotification('Failed to perform full sync. Please try again.', true);
    } finally {
        // Clean up
        isSyncing = false;
        stopSyncStatusPolling();
        setTimeout(() => {
            showSyncProgressBar(false);
            clearSyncProgressInterval();
        }, 1500);
    }
}

// Initialize sync UI
function initSyncUI() {
    // Reset counters
    syncStartTime = new Date();
    pagesProcessed = 0;
    cardsGenerated = 0;
    
    // Clear log
    const syncLog = document.getElementById('sync-log');
    if (syncLog) {
        syncLog.innerHTML = '';
    }
    
    // Show details container
    const detailsContainer = document.getElementById('sync-details-container');
    if (detailsContainer) {
        detailsContainer.style.display = 'block';
    }
    
    // Update stats display
    updateSyncStats();
    
    // Start time tracker
    startSyncProgressInterval();
    
    // Set up log toggle button
    const toggleLogBtn = document.getElementById('toggle-sync-log');
    if (toggleLogBtn) {
        toggleLogBtn.textContent = syncLogVisible ? 'Hide' : 'Show';
        toggleLogBtn.onclick = toggleSyncLog;
    }
}

// Update sync status message
function updateSyncStatus(message, type = '') {
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus) {
        // Remove all status classes
        syncStatus.classList.remove('active', 'error', 'success');
        
        // Add appropriate class if specified
        if (type) {
            syncStatus.classList.add(type);
        }
        
        syncStatus.textContent = message;
    }
}

// Update progress bar
function updateSyncProgress(percent) {
    const progressBar = document.getElementById('sync-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }
}

// Show/hide progress bar
function showSyncProgressBar(show) {
    const progressContainer = document.getElementById('sync-progress-container');
    if (progressContainer) {
        progressContainer.style.display = show ? 'flex' : 'none';
    }
}

// Add entry to sync log
function addSyncLogEntry(message, type = '') {
    const syncLog = document.getElementById('sync-log');
    if (!syncLog) return;
    
    const entry = document.createElement('div');
    entry.className = `sync-log-entry ${type}`;
    
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    let messageHtml = message;
    // Highlight important parts (anything in quotes)
    messageHtml = messageHtml.replace(/"([^"]+)"/g, '"<span class="highlight">$1</span>"');
    
    entry.innerHTML = `
        <span class="timestamp">${timestamp}</span>
        <span class="message">${messageHtml}</span>
    `;
    
    syncLog.appendChild(entry);
    syncLog.scrollTop = syncLog.scrollHeight;
}

// Toggle sync log visibility
function toggleSyncLog() {
    const syncLog = document.getElementById('sync-log');
    const toggleBtn = document.getElementById('toggle-sync-log');
    
    if (!syncLog || !toggleBtn) return;
    
    syncLogVisible = !syncLogVisible;
    syncLog.style.display = syncLogVisible ? 'block' : 'none';
    toggleBtn.textContent = syncLogVisible ? 'Hide' : 'Show';
}

// Update sync statistics
function updateSyncStats() {
    const pagesElement = document.getElementById('pages-processed');
    const cardsElement = document.getElementById('cards-generated');
    const timeElement = document.getElementById('time-elapsed');
    
    if (pagesElement) pagesElement.textContent = pagesProcessed;
    if (cardsElement) cardsElement.textContent = cardsGenerated;
    
    if (timeElement && syncStartTime) {
        const elapsedSeconds = Math.floor((new Date() - syncStartTime) / 1000);
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;
        timeElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Start sync progress interval for time tracking
function startSyncProgressInterval() {
    clearSyncProgressInterval();
    syncProgressInterval = setInterval(() => {
        updateSyncStats();
    }, 1000);
}

// Clear sync progress interval
function clearSyncProgressInterval() {
    if (syncProgressInterval) {
        clearInterval(syncProgressInterval);
        syncProgressInterval = null;
    }
}

// Polling for sync status (simulate real-time updates)
let syncStatusPollingInterval = null;

function startSyncStatusPolling(sectionId) {
    stopSyncStatusPolling();
    
    // Poll every 3 seconds
    syncStatusPollingInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/sync/status`);
            if (!response.ok) return;
            
            const data = await response.json();
            
            // Check for section-specific data
            if (data[sectionId]) {
                const sectionData = data[sectionId];
                
                // Update progress based on section data
                if (sectionData.pages) {
                    pagesProcessed = sectionData.pages;
                    updateSyncProgress(Math.min(75, 5 + (pagesProcessed * 10)));
                    updateSyncStats();
                    addSyncLogEntry(`Found ${pagesProcessed} pages to process`);
                }
            }
            
            // Update for any current operations
            if (data.currentOperation) {
                updateSyncStatus(`${data.currentOperation}...`, 'active');
                addSyncLogEntry(data.currentOperation);
            }
            
        } catch (error) {
            console.log('Error polling sync status:', error);
        }
    }, 3000);
}

function stopSyncStatusPolling() {
    if (syncStatusPollingInterval) {
        clearInterval(syncStatusPollingInterval);
        syncStatusPollingInterval = null;
    }
}

// Helper to get notebook name
function getNotebookName(notebookId) {
    const notebookSelect = document.getElementById('notebook-select');
    if (notebookSelect) {
        const option = notebookSelect.querySelector(`option[value="${notebookId}"]`);
        if (option) {
            return option.textContent;
        }
    }
    return 'Selected notebook';
}

// Save last sync info to API
async function saveLastSyncInfo(notebookId, sectionId) {
    try {
        const response = await fetch('/api/sync/save-last', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                notebookId,
                sectionId
            })
        });
        
        if (!response.ok) {
            console.error('Failed to save last sync info:', response.status);
        }
    } catch (error) {
        console.error('Error saving last sync info:', error);
    }
}

// Load saved selection from localStorage
function loadLastSelection() {
    const savedSelection = localStorage.getItem('lastSelection');
    if (!savedSelection) return;
    
    try {
        const { notebookId, sectionId } = JSON.parse(savedSelection);
        
        if (!notebookId) return;
        
        // Set notebook select value
        const notebookSelect = document.getElementById('notebook-select');
        if (notebookSelect) {
            notebookSelect.value = notebookId;
            currentNotebookId = notebookId;
            
            // Load sections for this notebook
            loadSections(notebookId).then(() => {
                if (!sectionId) return;
                
                // Set section select value
                const sectionSelect = document.getElementById('section-select');
                if (sectionSelect) {
                    sectionSelect.value = sectionId;
                    currentSectionId = sectionId;
                    
                    // Enable sync buttons
                    const syncButton = document.getElementById('sync-button');
                    const fullSyncButton = document.getElementById('full-sync-button');
                    if (syncButton) syncButton.disabled = false;
                    if (fullSyncButton) fullSyncButton.disabled = false;
                }
            });
        }
    } catch (error) {
        console.error('Error loading saved selection:', error);
    }
}

// Save selection to localStorage
function saveSelection() {
    if (!currentNotebookId || !currentSectionId) return;
    
    localStorage.setItem('lastSelection', JSON.stringify({
        notebookId: currentNotebookId,
        sectionId: currentSectionId
    }));
}

// Check URL parameters for direct access
function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const pageId = urlParams.get('page');
    
    if (pageId && allFlashcards && allFlashcards[pageId]) {
        selectPage(pageId);
    }
}

// Generate shareable URL
function getShareableUrl(pageId) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?page=${pageId}`;
}

// Batch editing functions
function enableBatchEditMode() {
    // Enable checkboxes on cards
    const pagesList = document.getElementById('pages-list');
    if (pagesList) {
        const listItems = pagesList.querySelectorAll('li');
        listItems.forEach(item => {
            // Add checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'form-check-input me-2 batch-select';
            item.prepend(checkbox);
        });
    }
}

function applyBatchEdits() {
    // Get all selected cards
    const selectedItems = document.querySelectorAll('.batch-select:checked');
    if (selectedItems.length === 0) {
        showNotification('No cards selected for batch editing', true);
        return;
    }
    
    // Get batch edit values
    const addTagsInput = document.getElementById('batch-add-tags');
    const removeTagsInput = document.getElementById('batch-remove-tags');
    const suspendToggle = document.getElementById('batch-suspend');
    
    const addTags = addTagsInput ? addTagsInput.value.split(',').map(t => t.trim()).filter(t => t) : [];
    const removeTags = removeTagsInput ? removeTagsInput.value.split(',').map(t => t.trim()).filter(t => t) : [];
    const suspend = suspendToggle ? suspendToggle.checked : false;
    
    // Apply edits to each selected card
    let editCount = 0;
    let pagesEdited = [];
    
    selectedItems.forEach(checkbox => {
        const pageId = checkbox.closest('li').dataset.pageId;
        if (!pageId || !allFlashcards[pageId] || !allFlashcards[pageId].cards) return;
        
        // Apply to all cards in the page
        allFlashcards[pageId].cards.forEach(card => {
            if (!card) return;
            
            // Initialize tags array if it doesn't exist
            if (!card.tags) card.tags = [];
            
            // Add tags
            addTags.forEach(tag => {
                if (!card.tags.includes(tag)) {
                    card.tags.push(tag);
                }
            });
            
            // Remove tags
            if (removeTags.length > 0) {
                card.tags = card.tags.filter(tag => !removeTags.includes(tag));
            }
            
            // Apply suspend state
            if (suspend) {
                card.suspended = true;
            }
            
            editCount++;
        });
        
        pagesEdited.push(pageId);
    });
    
    // Save changes
    saveFlashcardsToLocalStorage();
    saveFlashcardsToServer();
    
    // Remove checkboxes
    const checkboxes = document.querySelectorAll('.batch-select');
    checkboxes.forEach(checkbox => checkbox.remove());
    
    // Update UI
    updateTagFilterList();
    
    // Hide batch edit modal
    const batchEditModal = bootstrap.Modal.getInstance(document.getElementById('batch-edit-modal'));
    if (batchEditModal) {
        batchEditModal.hide();
    }
    
    // Refresh display if current page was edited
    if (pagesEdited.includes(currentPageId)) {
        displayCurrentCard();
    }
    
    showNotification(`Batch edit applied to ${editCount} cards across ${pagesEdited.length} pages`);
}

function cancelBatchEdits() {
    // Remove checkboxes
    const checkboxes = document.querySelectorAll('.batch-select');
    checkboxes.forEach(checkbox => checkbox.remove());
}

// Card editor functions
function openCardEditor(pageId, cardIndex) {
    if (!allFlashcards[pageId] || !allFlashcards[pageId].cards[cardIndex]) return;
    
    const card = allFlashcards[pageId].cards[cardIndex];
    
    // Populate editor fields
    const questionField = document.getElementById('edit-question');
    const answerField = document.getElementById('edit-answer');
    const tagsField = document.getElementById('edit-tags');
    
    if (questionField) questionField.value = card.question;
    if (answerField) answerField.value = card.answer;
    if (tagsField) tagsField.value = card.tags ? card.tags.join(', ') : '';
    
    // Switch to editor view
    showView('editor');
}

function closeCardEditor() {
    // Switch back to cards view
    showView('cards');
}

// Function to open the Add Card modal
function openAddCardModal() {
    // Clear previous input
    document.getElementById('new-question').value = '';
    document.getElementById('new-answer').value = '';
    document.getElementById('new-tags').value = '';
    
    // Show the modal
    const addCardModal = new bootstrap.Modal(document.getElementById('add-card-modal'));
    addCardModal.show();
}

// Function to save a new card
function saveNewCard() {
    // Get input values
    const questionField = document.getElementById('new-question');
    const answerField = document.getElementById('new-answer');
    const tagsField = document.getElementById('new-tags');
    
    if (!questionField || !answerField) {
        return;
    }
    
    const newQuestion = questionField.value.trim();
    const newAnswer = answerField.value.trim();
    const newTags = tagsField.value ? tagsField.value.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    
    // Validate input
    if (!newQuestion || !newAnswer) {
        showNotification('Question and answer are required', true);
        return;
    }
    
    // Make sure we have a valid currentPageId
    if (!currentPageId || !allFlashcards[currentPageId]) {
        showNotification('No active deck selected', true);
        return;
    }
    
    // Create new card object
    const newCard = {
        question: newQuestion,
        answer: newAnswer,
        tags: newTags,
        interval: 0,
        ease: EASE_FACTOR_DEFAULT,
        due: null,
        reviewCount: 0,
        suspended: false,
        created: new Date().toISOString()
    };
    
    // Add card to the deck
    if (!allFlashcards[currentPageId].cards) {
        allFlashcards[currentPageId].cards = [];
    }
    
    allFlashcards[currentPageId].cards.push(newCard);
    
    // Update last modified timestamp
    allFlashcards[currentPageId].lastUpdated = new Date().toISOString();
    
    // Save changes
    saveFlashcardsToLocalStorage();
    saveFlashcardsToServer();
    
    // Update UI
    renderPagesList();
    updateTagFilterList();
    
    // Close the modal
    const addCardModal = bootstrap.Modal.getInstance(document.getElementById('add-card-modal'));
    if (addCardModal) {
        addCardModal.hide();
    }
    
    // Show notification
    showNotification('New card added successfully');
    
    // If we're in the cards view, update the card counter and show the last card
    if (currentView === 'cards') {
        // Set current card index to the new card
        currentCardIndex = allFlashcards[currentPageId].cards.length - 1;
        displayCurrentCard();
    }
}

function saveCardEdits() {
    // Get edited values
    const questionField = document.getElementById('edit-question');
    const answerField = document.getElementById('edit-answer');
    const tagsField = document.getElementById('edit-tags');
    
    if (!questionField || !answerField) {
        closeCardEditor();
        return;
    }
    
    const newQuestion = questionField.value.trim();
    const newAnswer = answerField.value.trim();
    const newTags = tagsField.value.split(',').map(tag => tag.trim()).filter(tag => tag);
    
    // Validate
    if (!newQuestion || !newAnswer) {
        showNotification('Question and answer are required', true);
        return;
    }
    
    // Update card
    if (!currentPageId || !allFlashcards[currentPageId] || 
        !allFlashcards[currentPageId].cards[currentCardIndex]) {
        closeCardEditor();
        return;
    }
    
    const card = allFlashcards[currentPageId].cards[currentCardIndex];
    card.question = newQuestion;
    card.answer = newAnswer;
    card.tags = newTags;
    
    // Save changes
    saveFlashcardsToLocalStorage();
    saveFlashcardsToServer();
    
    // Update UI
    closeCardEditor();
    displayCurrentCard();
    updateTagFilterList();
    
    showNotification('Card updated successfully');
}

// Study session functions
function startStudySession(includeDue, includeNew, limit, tags) {
    // Create a queue of cards to study
    const studyQueue = [];
    const reviewCards = [];
    const newCards = [];
    
    // First, collect all due cards
    if (includeDue) {
        const today = new Date();
        
        Object.entries(allFlashcards).forEach(([pageId, page]) => {
            if (!page.cards) return;
            
            page.cards.forEach((card, index) => {
                // Check if card is due
                if (card.due && new Date(card.due) <= today && !card.suspended) {
                    // Check tags if specified
                    const matchesTags = tags.length === 0 || 
                        (card.tags && tags.some(tag => card.tags.includes(tag)));
                    
                    if (matchesTags) {
                        reviewCards.push({
                            pageId,
                            cardIndex: index,
                            type: 'review',
                            due: new Date(card.due)
                        });
                    }
                }
            });
        });
    }
    
    // Sort review cards by due date (earliest first)
    reviewCards.sort((a, b) => a.due - b.due);
    
    // Limit review cards based on user settings
    const maxReviews = Math.min(userSettings.reviewsPerDay, limit);
    const limitedReviewCards = reviewCards.slice(0, maxReviews);
    studyQueue.push(...limitedReviewCards);
    
    // Then, collect new cards if needed
    if (includeNew) {
        Object.entries(allFlashcards).forEach(([pageId, page]) => {
            if (!page.cards) return;
            
            page.cards.forEach((card, index) => {
                // Check if card is new (never reviewed)
                if (!card.due && !card.suspended) {
                    // Check tags if specified
                    const matchesTags = tags.length === 0 || 
                        (card.tags && tags.some(tag => card.tags.includes(tag)));
                    
                    if (matchesTags) {
                        newCards.push({
                            pageId,
                            cardIndex: index,
                            type: 'new'
                        });
                    }
                }
            });
        });
        
        // Sort new cards according to settings
        if (userSettings.cardOrderNew === 'random') {
            // Shuffle new cards
            for (let i = newCards.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newCards[i], newCards[j]] = [newCards[j], newCards[i]];
            }
        }
        
        // Limit new cards based on user settings and remaining limit
        const remainingLimit = limit - limitedReviewCards.length;
        const maxNewCards = Math.min(userSettings.newCardsPerDay, remainingLimit);
        const limitedNewCards = newCards.slice(0, maxNewCards);
        studyQueue.push(...limitedNewCards);
    }
    
    // If no cards to study, show message
    if (studyQueue.length === 0) {
        showNotification('No cards to study based on your criteria.', true);
        return;
    }
    
    // Store queue in study session
    studySession = {
        active: true,
        queue: studyQueue,
        currentIndex: 0,
        startTime: new Date()
    };
    
    // Save session state
    saveStudySession();
    
    // Begin study mode
    showView('study');
    showStudyCard();
}

// Save study session to localStorage
function saveStudySession() {
    try {
        localStorage.setItem('studySession', JSON.stringify(studySession));
    } catch (error) {
        console.error('Error saving study session:', error);
    }
}

// Replace showStudyCard with this diagnostic version
function showStudyCard() {
    console.log("showStudyCard called");
    
    // Check if we've reached the end of the queue
    if (studySession.currentIndex >= studySession.queue.length) {
        console.log("End of queue reached, showing completion");
        showStudyCompletion();
        return;
    }
    
    // Get current card info
    const currentItem = studySession.queue[studySession.currentIndex];
    const { pageId, cardIndex, type } = currentItem;
    
    console.log(`Showing card ${cardIndex} from page ${pageId}, type: ${type}`);
    
    // Get card from flashcards
    if (!allFlashcards[pageId] || !allFlashcards[pageId].cards[cardIndex]) {
        console.log("Invalid card, skipping to next");
        studySession.currentIndex++;
        saveStudySession();
        showStudyCard();
        return;
    }
    
    const card = allFlashcards[pageId].cards[cardIndex];
    
    // NUCLEAR OPTION: Hide all rating buttons from the DOM completely
    const answerButtonsDiv = document.getElementById('study-answer-buttons');
    
    if (answerButtonsDiv) {
        console.log("Found answer buttons, hiding them");
        // First, try standard approach
        answerButtonsDiv.style.display = 'none';
        // Then try force-hidden class
        answerButtonsDiv.classList.add('force-hidden');
        
        // Nuclear approach: actually remove the buttons from DOM temporarily
        if (answerButtonsDiv.parentNode) {
            console.log("Temporarily removing buttons from DOM");
            // Store reference for later
            window._savedButtonsDiv = answerButtonsDiv;
            answerButtonsDiv.parentNode.removeChild(answerButtonsDiv);
        }
    } else {
        console.log("Could not find answer buttons div!");
    }
    
    // Get UI elements
    const questionEl = document.getElementById('study-question');
    const answerEl = document.getElementById('study-answer');
    const pageTitle = document.getElementById('study-page-title');
    const cardType = document.getElementById('study-card-type');
    const showAnswerBtn = document.getElementById('study-show-answer');
    
    // Update page title
    if (pageTitle) {
        pageTitle.textContent = allFlashcards[pageId].pageTitle;
    }
    
    // Update card type
    if (cardType) {
        if (type === 'new') {
            cardType.textContent = 'New Card';
            cardType.className = 'badge bg-primary';
        } else {
            cardType.textContent = 'Review';
            cardType.className = 'badge bg-info';
        }
    }
    
    // Set question and answer
    if (questionEl) questionEl.innerHTML = card.question;
    if (answerEl) {
        answerEl.innerHTML = card.answer;
        answerEl.classList.add('hidden');
    }
    
    // Show answer button
    if (showAnswerBtn) {
        console.log("Showing answer button");
        showAnswerBtn.style.display = 'block';
    }
    
    // Update study status
    updateStudyStatusDisplay();
    
    // Update spaced repetition button labels
    updateStudyAnswerButtonLabels(card);
    
    console.log("showStudyCard completed");
}

function updateStudyStatusDisplay() {
    const statusContainer = document.getElementById('study-session-status');
    if (!statusContainer) return;
    
    const currentIndex = studySession.currentIndex;
    const totalCards = studySession.queue.length;
    const newCards = studySession.queue.filter(item => item.type === 'new').length;
    const reviewCards = totalCards - newCards;
    
    statusContainer.innerHTML = `
        <div class="study-status">
            <div class="progress mb-2" style="height: 8px;">
                <div class="progress-bar" role="progressbar" style="width: ${(currentIndex / totalCards * 100)}%"></div>
            </div>
            <div class="d-flex justify-content-between">
                <div><span class="badge bg-primary">${newCards}</span> New</div>
                <div><span class="badge bg-info">${reviewCards}</span> Review</div>
                <div><span class="badge bg-success">${currentIndex}</span> / ${totalCards} Cards</div>
            </div>
        </div>
    `;
}

function updateStudyAnswerButtonLabels(card) {
    const againBtn = document.getElementById('study-again');
    const hardBtn = document.getElementById('study-hard');
    const goodBtn = document.getElementById('study-good');
    const easyBtn = document.getElementById('study-easy');
    
    if (!againBtn || !hardBtn || !goodBtn || !easyBtn) return;
    
    // Calculate intervals for each button
    let againInterval = "1d";
    let hardInterval = "2d";
    let goodInterval = "3d";
    let easyInterval = "4d";
    
    if (card.interval) {
        // For cards with existing intervals
        againInterval = "1d";
        hardInterval = Math.max(2, Math.ceil(card.interval * NEW_INTERVAL_HARD)) + "d";
        goodInterval = Math.ceil(card.interval * (card.ease || EASE_FACTOR_DEFAULT)) + "d";
        easyInterval = Math.ceil(card.interval * (card.ease || EASE_FACTOR_DEFAULT) * EASE_MODIFIER_EASY) + "d";
    }
    
    // Update button labels
    const againLabel = againBtn.querySelector('.btn-interval');
    const hardLabel = hardBtn.querySelector('.btn-interval');
    const goodLabel = goodBtn.querySelector('.btn-interval');
    const easyLabel = easyBtn.querySelector('.btn-interval');
    
    if (againLabel) againLabel.textContent = againInterval;
    if (hardLabel) hardLabel.textContent = hardInterval;
    if (goodLabel) goodLabel.textContent = goodInterval;
    if (easyLabel) easyLabel.textContent = easyInterval;
}

// Replace showStudyAnswer with this diagnostic version
function showStudyAnswer() {
    console.log("showStudyAnswer called");
    
    const answerEl = document.getElementById('study-answer');
    const showAnswerBtn = document.getElementById('study-show-answer');
    
    if (answerEl) {
        console.log("Revealing answer");
        answerEl.classList.remove('hidden');
    }
    
    if (showAnswerBtn) {
        console.log("Hiding show answer button");
        showAnswerBtn.style.display = 'none';
    }
    
    // NUCLEAR OPTION: Re-add the buttons to DOM
    if (window._savedButtonsDiv) {
        console.log("Re-adding answer buttons to DOM");
        // Find the right place to add them back - assuming it's the study card
        const studyCard = document.getElementById('study-card');
        if (studyCard) {
            // Find the footer area
            const footer = studyCard.querySelector('.study-footer');
            if (footer) {
                console.log("Found study footer, adding buttons back");
                footer.appendChild(window._savedButtonsDiv);
                // Make buttons visible
                window._savedButtonsDiv.classList.remove('force-hidden');
                window._savedButtonsDiv.style.display = 'flex';
            } else {
                console.log("Could not find study footer!");
            }
        } else {
            console.log("Could not find study card!");
        }
    } else {
        console.log("No saved buttons div found!");
        
        // Try to find the buttons div
        const answerButtons = document.getElementById('study-answer-buttons');
        if (answerButtons) {
            console.log("Found answer buttons, making them visible");
            answerButtons.classList.remove('force-hidden');
            answerButtons.style.display = 'flex';
        }
    }
    
    console.log("showStudyAnswer completed");
}

// Replace answerStudyCard with this diagnostic version
function answerStudyCard(rating) {
    console.log(`answerStudyCard called with rating: ${rating}`);
    
    // Get current item from queue
    if (studySession.currentIndex >= studySession.queue.length) {
        console.log("Invalid study session index");
        return;
    }
    
    const { pageId, cardIndex } = studySession.queue[studySession.currentIndex];
    
    console.log(`Answering card ${cardIndex} from page ${pageId}`);
    
    // Get card
    if (!allFlashcards[pageId] || !allFlashcards[pageId].cards[cardIndex]) {
        console.log("Invalid card, skipping to next");
        studySession.currentIndex++;
        saveStudySession();
        showStudyCard();
        return;
    }
    
    const card = allFlashcards[pageId].cards[cardIndex];
    
    // Log card state before
    console.log("Card before update:", {
        interval: card.interval,
        ease: card.ease,
        due: card.due,
        reviewCount: card.reviewCount
    });
    
    // Apply spaced repetition algorithm
    applySpacedRepetition(card, rating);
    
    // Log card state after
    console.log("Card after update:", {
        interval: card.interval,
        ease: card.ease,
        due: card.due,
        reviewCount: card.reviewCount
    });
    
    // Record review
    recordCardReview(cardIndex, pageId, rating);
    
    // Save changes
    saveFlashcardsToLocalStorage();
    saveFlashcardsToServer();
    
    // NUCLEAR OPTION: Hide buttons by removing from DOM again
    const answerButtonsDiv = document.getElementById('study-answer-buttons');
    if (answerButtonsDiv && answerButtonsDiv.parentNode) {
        console.log("Removing buttons from DOM after answer");
        window._savedButtonsDiv = answerButtonsDiv;
        answerButtonsDiv.parentNode.removeChild(answerButtonsDiv);
    }
    
    // Hide answer 
    const answerEl = document.getElementById('study-answer');
    if (answerEl) {
        answerEl.classList.add('hidden');
    }
    
    // Show answer button for next card
    const showAnswerBtn = document.getElementById('study-show-answer');
    if (showAnswerBtn) {
        showAnswerBtn.style.display = 'block';
    }
    
    // Move to next card
    studySession.currentIndex++;
    saveStudySession();
    
    // Log deck state before showing next card
    debugDeckCounts();
    
    showStudyCard();
    
    console.log("answerStudyCard completed");
}

function showStudyCompletion() {
    // Hide study card container
    const studyCardEl = document.getElementById('study-card');
    if (studyCardEl) studyCardEl.style.display = 'none';
    
    // Show completion screen
    const completionEl = document.getElementById('study-completed');
    if (completionEl) completionEl.style.display = 'block';
    
    // Calculate stats
    const totalCards = studySession.queue.length;
    const newCards = studySession.queue.filter(card => card.type === 'new').length;
    const reviewCards = totalCards - newCards;
    
    // Get study time
    let studyMinutes = 0;
    if (studySession.startTime) {
        const endTime = new Date();
        studyMinutes = Math.round((endTime - studySession.startTime) / (1000 * 60));
        
        // Record study time in stats
        userStudyStats.studyTimeMinutes = (userStudyStats.studyTimeMinutes || 0) + studyMinutes;
        saveStudyStats();
    }
    
    // Display completion stats
    const statsEl = document.getElementById('study-completed-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="text-center mb-4">
                <div class="display-1 text-success mb-3"><i class="bi bi-check-circle"></i></div>
                <h3>Study Session Complete!</h3>
                <p class="lead">You've reviewed ${totalCards} cards</p>
            </div>
            <div class="row">
                <div class="col-6 text-center">
                    <div class="display-4 text-primary">${newCards}</div>
                    <p>New Cards</p>
                </div>
                <div class="col-6 text-center">
                    <div class="display-4 text-info">${reviewCards}</div>
                    <p>Reviews</p>
                </div>
            </div>
            <div class="text-center mt-3">
                <p class="text-muted">Study time: ${studyMinutes} minutes</p>
            </div>
        `;
    }
}

// Replace exitStudyMode with this diagnostic version
function exitStudyMode() {
    console.log("exitStudyMode called");
    
    // Log deck state before exiting
    console.log("Deck state before exit:");
    debugDeckCounts();
    
    // Mark study session as inactive
    studySession.active = false;
    saveStudySession();
    
    // CRITICAL: Force redraw by adding a dummy element then removing it
    const body = document.body;
    const dummy = document.createElement('div');
    dummy.style.display = 'none';
    body.appendChild(dummy);
    
    // Force reflow
    void dummy.offsetHeight;
    
    // Update deck view with latest progress
    console.log("Calling renderPagesList and updateDueCounts");
    renderPagesList();
    updateDueCounts();
    
    // Remove dummy element
    body.removeChild(dummy);
    
    // Log deck state after rendering
    console.log("Deck state after rendering:");
    debugDeckCounts();
    
    // Switch to home view with slight delay to allow state update
    setTimeout(() => {
        console.log("Showing home view");
        showView('home');
        
        // Force a second update after view change
        setTimeout(() => {
            console.log("Forcing second update");
            renderPagesList();
            updateDueCounts();
            
            // Final deck state log
            console.log("Final deck state:");
            debugDeckCounts();
        }, 300);
    }, 100);
    
    console.log("exitStudyMode completed");
}

// Save flashcards to localStorage (for persistence between syncs)
function saveFlashcardsToLocalStorage() {
    try {
        localStorage.setItem('allFlashcards', JSON.stringify(allFlashcards));
    } catch (error) {
        console.error('Error saving flashcards to localStorage:', error);
        
        // If error is due to storage limit, try to compress by removing non-essential data
        if (error.name === 'QuotaExceededError') {
            try {
                // Create a copy with only essential data
                const compressedFlashcards = {};
                
                Object.entries(allFlashcards).forEach(([pageId, pageData]) => {
                    compressedFlashcards[pageId] = {
                        pageTitle: pageData.pageTitle,
                        cards: pageData.cards.map(card => ({
                            question: card.question,
                            answer: card.answer,
                            interval: card.interval,
                            ease: card.ease,
                            due: card.due,
                            reviewCount: card.reviewCount,
                            tags: card.tags,
                            suspended: card.suspended
                        }))
                    };
                });
                
                localStorage.setItem('allFlashcards', JSON.stringify(compressedFlashcards));
                console.log('Saved compressed flashcards to localStorage');
            } catch (compressionError) {
                console.error('Error saving compressed flashcards:', compressionError);
                showNotification('Warning: Could not save all cards to local storage', true);
            }
        }
    }
}

// Save flashcards to the server
async function saveFlashcardsToServer() {
    try {
        // Only attempt if authenticated
        const authStatus = await checkAuthStatus();
        if (!authStatus.authenticated) return;
        
        // If offline, queue save for later
        if (!navigator.onLine) {
            pendingSaves.push({
                timestamp: Date.now(),
                data: JSON.parse(JSON.stringify(allFlashcards))
            });
            localStorage.setItem('pendingSaves', JSON.stringify(pendingSaves));
            console.log('Offline - queued flashcard save for later');
            return;
        }
        
        // Process any pending saves first
        if (pendingSaves.length > 0) {
            console.log(`Attempting to process ${pendingSaves.length} pending saves`);
            await processPendingSaves();
        }
        
        showLoading('Saving progress...');
        
        const response = await fetch('/api/flashcards/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(allFlashcards)
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save flashcards: ${response.status}`);
        }
        
        hideLoading();
        console.log('Saved study progress to server');
    } catch (error) {
        hideLoading();
        console.error('Error saving flashcards to server:', error);
        
        // If failed due to network, queue for later
        if (!navigator.onLine || error.name === 'NetworkError') {
            pendingSaves.push({
                timestamp: Date.now(),
                data: JSON.parse(JSON.stringify(allFlashcards))
            });
            localStorage.setItem('pendingSaves', JSON.stringify(pendingSaves));
            console.log('Network error - queued flashcard save for later');
        }
    }
}

// Load flashcards from localStorage
function loadFlashcardsFromLocalStorage() {
    try {
        const savedFlashcards = localStorage.getItem('allFlashcards');
        if (savedFlashcards) {
            return JSON.parse(savedFlashcards);
        }
    } catch (error) {
        console.error('Error loading flashcards from localStorage:', error);
    }
    return null;
}

// UI helper functions
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

// Ensure compatibility with touch devices
document.addEventListener('touchstart', function() {}, {passive: true});

// Utility Functions

// Debounce function to prevent excessive function calls
function debounce(func, wait = 300) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}