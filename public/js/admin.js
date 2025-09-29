// Battle Decks - Admin Interface JavaScript

class AdminController {
    constructor() {
        // Current session state
        this.currentSession = null;
        this.sessionStartTime = null;

        // Deck management state
        this.currentDeckId = null;
        this.availableDecks = [];

        // Game state
        this.gameState = {
            sessionId: null,
            phase: 'waiting',
            slideCount: 1,
            maxSlides: 10,
            votes: { logical: 0, chaotic: 0 },
            timeRemaining: 0,
            votingOpen: false
        };

        // Activity log
        this.activityLog = [];

        // DOM elements
        this.elements = {
            connectionStatus: document.getElementById('connectionStatus'),
            createSessionBtn: document.getElementById('createSessionBtn'),
            sessionInfo: document.getElementById('sessionInfo'),
            sessionCode: document.getElementById('sessionCode'),
            sessionUrl: document.getElementById('sessionUrl'),
            sessionStatus: document.getElementById('sessionStatus'),
            maxSlidesInput: document.getElementById('maxSlidesInput'),
            startGameBtn: document.getElementById('startGameBtn'),
            resetGameBtn: document.getElementById('resetGameBtn'),
            gameStatus: document.getElementById('gameStatus'),
            currentPhase: document.getElementById('currentPhase'),
            currentSlideStatus: document.getElementById('currentSlideStatus'),
            maxSlidesStatus: document.getElementById('maxSlidesStatus'),
            timeRemainingStatus: document.getElementById('timeRemainingStatus'),
            logicalVotes: document.getElementById('logicalVotes'),
            chaoticVotes: document.getElementById('chaoticVotes'),
            connectedUsers: document.getElementById('connectedUsers'),
            sessionAge: document.getElementById('sessionAge'),
            copySessionBtn: document.getElementById('copySessionBtn'),
            copyUrlBtn: document.getElementById('copyUrlBtn'),
            openDisplayBtn: document.getElementById('openDisplayBtn'),
            refreshStatusBtn: document.getElementById('refreshStatusBtn'),
            downloadLogBtn: document.getElementById('downloadLogBtn'),
            clearLogBtn: document.getElementById('clearLogBtn'),
            activityLog: document.getElementById('activityLog')
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadDecks(); // Load available decks
        this.addLogEntry('Presenter control panel loaded');
        this.updateConnectionStatus('disconnected');
        this.startSessionAgeTimer();
    }

    setupEventListeners() {
        // Session management
        this.elements.createSessionBtn.addEventListener('click', () => this.createSession());

        // Game controls
        this.elements.startGameBtn.addEventListener('click', () => this.startGame());
        this.elements.resetGameBtn.addEventListener('click', () => this.resetGame());

        // Quick actions
        this.elements.copySessionBtn.addEventListener('click', () => this.copySessionCode());
        this.elements.copyUrlBtn.addEventListener('click', () => this.copyVoteUrl());
        this.elements.openDisplayBtn.addEventListener('click', () => this.openDisplay());
        this.elements.refreshStatusBtn.addEventListener('click', () => this.refreshStatus());
        this.elements.downloadLogBtn.addEventListener('click', () => this.downloadLog());
        this.elements.clearLogBtn.addEventListener('click', () => this.clearLog());

        // Max slides input
        this.elements.maxSlidesInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            if (value < 3) e.target.value = 3;
            if (value > 20) e.target.value = 20;
        });
    }

    async createSession() {
        this.elements.createSessionBtn.disabled = true;
        this.elements.createSessionBtn.textContent = 'Creating...';

        try {
            const response = await fetch('/create-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (result.success) {
                this.currentSession = result.sessionId;
                this.sessionStartTime = Date.now();

                // Update UI
                this.elements.sessionCode.textContent = result.sessionId;
                this.elements.sessionUrl.textContent = `Share this code with your audience: ${result.sessionId}`;
                this.elements.sessionInfo.classList.remove('hidden');

                // Enable game controls
                this.elements.startGameBtn.disabled = false;
                this.elements.copySessionBtn.disabled = false;
                this.elements.copyUrlBtn.disabled = false;

                this.showSessionStatus(`✅ Session created: ${result.sessionId}`, 'success');
                this.addLogEntry(`Session created: ${result.sessionId}`, 'info');

                // Start polling for status updates
                this.startStatusPolling();

            } else {
                this.showSessionStatus('❌ Failed to create session', 'error');
                this.addLogEntry('Failed to create session', 'error');
            }

        } catch (error) {
            this.addLogEntry(`Create session error: ${error.message}`, 'error');
            this.showSessionStatus('❌ Connection error. Please try again.', 'error');
        } finally {
            this.elements.createSessionBtn.disabled = false;
            this.elements.createSessionBtn.textContent = 'Create New Session';
        }
    }

    async startGame() {
        if (!this.currentSession) {
            this.showGameStatus('❌ No active session', 'error');
            return;
        }

        if (!this.currentDeckId) {
            this.showGameStatus('❌ No deck selected. Please select a deck first.', 'error');
            return;
        }

        const maxSlides = parseInt(this.elements.maxSlidesInput.value) || 10;

        this.elements.startGameBtn.disabled = true;
        this.elements.startGameBtn.textContent = 'Starting...';

        try {
            const response = await fetch(`/session/${this.currentSession}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deckId: this.currentDeckId || 'default',
                    maxSlides: maxSlides
                })
            });

            const result = await response.json();

            if (result.success) {
                this.gameState = { ...this.gameState, ...result.gameState };
                this.elements.resetGameBtn.disabled = false;
                this.showGameStatus('✅ Game started!', 'success');
                this.addLogEntry(`Game started with deck ${this.currentDeckId} (${maxSlides} max slides)`, 'info');
                this.updateStatus();
            } else {
                this.showGameStatus(`❌ ${result.error}`, 'error');
                this.addLogEntry(`Start game failed: ${result.error}`, 'error');
            }

        } catch (error) {
            this.addLogEntry(`Start game error: ${error.message}`, 'error');
            this.showGameStatus('❌ Connection error. Please try again.', 'error');
        } finally {
            this.elements.startGameBtn.disabled = false;
            this.elements.startGameBtn.textContent = 'Start Game';
        }
    }

    async resetGame() {
        if (!this.currentSession) return;

        const confirmed = confirm('Are you sure you want to reset the game? This will end the current session.');
        if (!confirmed) return;

        try {
            // For now, just create a new session
            this.addLogEntry('Game reset requested', 'warning');
            this.currentSession = null;
            this.sessionStartTime = null;

            // Reset UI
            this.elements.sessionInfo.classList.add('hidden');
            this.elements.startGameBtn.disabled = true;
            this.elements.resetGameBtn.disabled = true;
            this.elements.copySessionBtn.disabled = true;
            this.elements.copyUrlBtn.disabled = true;

            this.showGameStatus('Game reset. Create a new session to continue.', 'info');
            this.stopStatusPolling();
            this.resetStatus();

        } catch (error) {
            this.addLogEntry(`Reset game error: ${error.message}`, 'error');
        }
    }

    // ==================== DECK MANAGEMENT ====================

    async loadDecks() {
        try {
            const response = await fetch('/api/decks');
            if (!response.ok) throw new Error('Failed to load decks');

            const data = await response.json();
            this.availableDecks = data.decks || [];
            this.displayDecks();
            this.addLogEntry(`Loaded ${this.availableDecks.length} deck(s)`, 'info');
        } catch (error) {
            this.addLogEntry(`Error loading decks: ${error.message}`, 'error');
        }
    }

    displayDecks() {
        const deckSelect = document.getElementById('deckSelect');
        if (!deckSelect) return;

        if (this.availableDecks.length === 0) {
            deckSelect.innerHTML = '<option value="">No decks available</option>';
            deckSelect.disabled = true;
            return;
        }

        deckSelect.innerHTML = '<option value="">Select a deck...</option>' +
            this.availableDecks
                .filter(deck => deck.status === 'ready')
                .map(deck => `<option value="${deck.deckId}">${deck.name} (${deck.slideCount} slides)</option>`)
                .join('');

        deckSelect.disabled = false;

        // Add change event listener
        deckSelect.addEventListener('change', (e) => {
            this.selectDeck(e.target.value);
        });
    }

    selectDeck(deckId) {
        if (!deckId) {
            this.currentDeckId = null;
            this.addLogEntry('Deck deselected', 'info');
            return;
        }

        this.currentDeckId = deckId;
        const deck = this.availableDecks.find(d => d.deckId === deckId);
        if (deck) {
            this.addLogEntry(`Selected deck: ${deck.name} (${deck.slideCount} slides)`, 'info');
        }

        // Enable start button if session exists
        if (this.currentSession) {
            this.elements.startGameBtn.disabled = false;
        }
    }

    // ==================== END DECK MANAGEMENT ====================

    async refreshStatus() {
        if (!this.currentSession) return;

        this.elements.refreshStatusBtn.disabled = true;
        this.elements.refreshStatusBtn.textContent = '🔄 Refreshing...';

        try {
            const response = await fetch(`/session/${this.currentSession}/status`);

            if (response.ok) {
                const status = await response.json();
                this.gameState = { ...this.gameState, ...status };
                this.updateStatus();
                this.addLogEntry('Status refreshed', 'info');
                this.updateConnectionStatus('connected');
            } else {
                this.addLogEntry('Failed to refresh status', 'error');
                this.updateConnectionStatus('disconnected');
            }

        } catch (error) {
            this.addLogEntry(`Refresh status error: ${error.message}`, 'error');
            this.updateConnectionStatus('disconnected');
        } finally {
            this.elements.refreshStatusBtn.disabled = false;
            this.elements.refreshStatusBtn.textContent = '🔄 Refresh Status';
        }
    }

    startStatusPolling() {
        // Poll status every 5 seconds
        this.statusPollingInterval = setInterval(() => {
            this.refreshStatus();
        }, 5000);

        this.addLogEntry('Started status polling', 'info');
    }

    stopStatusPolling() {
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
            this.statusPollingInterval = null;
            this.addLogEntry('Stopped status polling', 'info');
        }
    }

    updateStatus() {
        // Update game status display
        this.elements.currentPhase.textContent = this.gameState.phase || '-';
        this.elements.currentSlideStatus.textContent = this.gameState.slideCount || '-';
        this.elements.maxSlidesStatus.textContent = this.gameState.maxSlides || '-';

        // Format time remaining
        const timeRemaining = this.gameState.timeRemaining || 0;
        if (timeRemaining > 0) {
            const seconds = Math.ceil(timeRemaining / 1000);
            this.elements.timeRemainingStatus.textContent = `${seconds}s`;
        } else {
            this.elements.timeRemainingStatus.textContent = '-';
        }

        // Update vote counts
        this.elements.logicalVotes.textContent = this.gameState.votes?.logical || 0;
        this.elements.chaoticVotes.textContent = this.gameState.votes?.chaotic || 0;

        // Placeholder for connected users (would need WebSocket connection counting)
        this.elements.connectedUsers.textContent = '1+';
    }

    resetStatus() {
        this.elements.currentPhase.textContent = '-';
        this.elements.currentSlideStatus.textContent = '-';
        this.elements.maxSlidesStatus.textContent = '-';
        this.elements.timeRemainingStatus.textContent = '-';
        this.elements.logicalVotes.textContent = '0';
        this.elements.chaoticVotes.textContent = '0';
        this.elements.connectedUsers.textContent = '0';
        this.elements.sessionAge.textContent = '-';
    }

    startSessionAgeTimer() {
        setInterval(() => {
            if (this.sessionStartTime) {
                const elapsed = Date.now() - this.sessionStartTime;
                const minutes = Math.floor(elapsed / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);
                this.elements.sessionAge.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            } else {
                this.elements.sessionAge.textContent = '-';
            }
        }, 1000);
    }

    async copySessionCode() {
        if (!this.currentSession) return;

        try {
            await navigator.clipboard.writeText(this.currentSession);
            this.showSessionStatus('✅ Session code copied to clipboard', 'success');
            this.addLogEntry('Session code copied to clipboard', 'info');
        } catch (error) {
            this.addLogEntry('Failed to copy session code', 'error');
            // Fallback: select and copy
            this.selectText(this.elements.sessionCode);
        }
    }

    async copyVoteUrl() {
        if (!this.currentSession) return;

        const voteUrl = `${window.location.origin}/vote?session=${this.currentSession}`;

        try {
            await navigator.clipboard.writeText(voteUrl);
            this.showSessionStatus('✅ Vote URL copied to clipboard', 'success');
            this.addLogEntry('Vote URL copied to clipboard', 'info');
        } catch (error) {
            this.addLogEntry('Failed to copy vote URL', 'error');
            // Fallback: show URL for manual copy
            prompt('Copy this URL:', voteUrl);
        }
    }

    openDisplay() {
        const displayUrl = this.currentSession ?
            `${window.location.origin}/display?session=${this.currentSession}` :
            `${window.location.origin}/display`;

        window.open(displayUrl, '_blank', 'width=1200,height=800');
        this.addLogEntry('Opened display window', 'info');
    }

    downloadLog() {
        const logData = this.activityLog.map(entry =>
            `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`
        ).join('\n');

        const blob = new Blob([logData], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `battle-decks-log-${new Date().toISOString().slice(0, 19)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.addLogEntry('Log downloaded', 'info');
    }

    clearLog() {
        const confirmed = confirm('Are you sure you want to clear the activity log?');
        if (confirmed) {
            this.activityLog = [];
            this.elements.activityLog.innerHTML = '';
            this.addLogEntry('Activity log cleared', 'info');
        }
    }

    selectText(element) {
        const range = document.createRange();
        range.selectNode(element);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    }

    showSessionStatus(message, type = 'info') {
        this.elements.sessionStatus.className = `status status-${type}`;
        this.elements.sessionStatus.textContent = message;
        this.elements.sessionStatus.classList.remove('hidden');

        setTimeout(() => {
            this.elements.sessionStatus.classList.add('hidden');
        }, 5000);
    }

    showGameStatus(message, type = 'info') {
        this.elements.gameStatus.className = `status status-${type}`;
        this.elements.gameStatus.textContent = message;
        this.elements.gameStatus.classList.remove('hidden');

        setTimeout(() => {
            this.elements.gameStatus.classList.add('hidden');
        }, 5000);
    }

    updateConnectionStatus(status) {
        const statusElement = this.elements.connectionStatus;

        statusElement.className = `connection-status ${status}`;

        switch (status) {
            case 'connected':
                statusElement.textContent = 'Connected';
                break;
            case 'connecting':
                statusElement.textContent = 'Connecting...';
                break;
            case 'disconnected':
                statusElement.textContent = 'Disconnected';
                break;
        }
    }

    addLogEntry(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = { timestamp, message, level };

        this.activityLog.push(entry);

        // Keep only last 100 entries
        if (this.activityLog.length > 100) {
            this.activityLog.shift();
        }

        // Add to DOM
        const logElement = document.createElement('div');
        logElement.className = `log-entry ${level}`;
        logElement.innerHTML = `
            <span class="log-timestamp">[${timestamp}]</span>
            ${message}
        `;

        this.elements.activityLog.appendChild(logElement);

        // Scroll to bottom
        this.elements.activityLog.scrollTop = this.elements.activityLog.scrollHeight;

        // Also log to console
        if (level === 'error') {
            console.error(`[${timestamp}] ${message}`);
        } else if (level === 'warning') {
            console.warn(`[${timestamp}] ${message}`);
        } else {
            console.log(`[${timestamp}] ${message}`);
        }
    }
}

// Initialize admin controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.adminController = new AdminController();
});