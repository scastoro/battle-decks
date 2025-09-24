// Battle Decks - Voting Interface JavaScript

class VoteController {
    constructor() {
        // WebSocket connection
        this.ws = null;
        this.connectionAttempts = 0;
        this.maxRetries = 5;
        this.retryDelay = 1000;

        // User and session state
        this.userId = 'user_' + Math.random().toString(36).substring(2, 11);
        this.currentSession = null;
        this.hasVoted = false;

        // Game state
        this.gameState = {
            sessionId: null,
            currentSlide: null,
            phase: 'waiting',
            votes: { logical: 0, chaotic: 0 },
            timeRemaining: 0,
            slideCount: 1,
            maxSlides: 10,
            votingOpen: false
        };

        // DOM elements
        this.elements = {
            connectionStatus: document.getElementById('connectionStatus'),
            joinPanel: document.getElementById('joinPanel'),
            votingPanel: document.getElementById('votingPanel'),
            roomCodeInput: document.getElementById('roomCodeInput'),
            joinBtn: document.getElementById('joinBtn'),
            joinStatus: document.getElementById('joinStatus'),
            currentSessionId: document.getElementById('currentSessionId'),
            currentSlideNumber: document.getElementById('currentSlideNumber'),
            maxSlidesDisplay: document.getElementById('maxSlidesDisplay'),
            phaseDisplay: document.getElementById('phaseDisplay'),
            votingInterface: document.getElementById('votingInterface'),
            waitingMessage: document.getElementById('waitingMessage'),
            presentingMessage: document.getElementById('presentingMessage'),
            logicalBtn: document.getElementById('logicalBtn'),
            chaoticBtn: document.getElementById('chaoticBtn'),
            voteStatus: document.getElementById('voteStatus'),
            liveLogicalCount: document.getElementById('liveLogicalCount'),
            liveChaoticCount: document.getElementById('liveChaoticCount'),
            presentTimeRemaining: document.getElementById('presentTimeRemaining')
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateConnectionStatus('disconnected');
        this.log('Vote interface initialized');

        // Check for session in URL
        const urlParams = new URLSearchParams(window.location.search);
        const sessionFromUrl = urlParams.get('session');
        if (sessionFromUrl) {
            this.elements.roomCodeInput.value = sessionFromUrl.toUpperCase();
            this.joinSession();
        }
    }

    setupEventListeners() {
        // Join session
        this.elements.joinBtn.addEventListener('click', () => this.joinSession());

        this.elements.roomCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinSession();
            }
        });

        this.elements.roomCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        // Voting buttons
        this.elements.logicalBtn.addEventListener('click', () => this.vote('logical'));
        this.elements.chaoticBtn.addEventListener('click', () => this.vote('chaotic'));

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.currentSession) {
                this.checkWebSocketConnection();
            }
        });

        window.addEventListener('focus', () => {
            if (this.currentSession) {
                this.checkWebSocketConnection();
            }
        });
    }

    async joinSession() {
        const roomCode = this.elements.roomCodeInput.value.trim().toUpperCase();

        if (!roomCode || roomCode.length !== 6) {
            this.showJoinStatus('Please enter a valid 6-character room code', 'error');
            return;
        }

        this.elements.joinBtn.disabled = true;
        this.elements.joinBtn.textContent = 'Joining...';

        try {
            // Check if session exists
            const response = await fetch(`/session/${roomCode}/status`);

            if (!response.ok) {
                if (response.status === 404) {
                    this.showJoinStatus('Session not found. Please check the room code.', 'error');
                } else {
                    this.showJoinStatus('Error connecting to session. Please try again.', 'error');
                }
                return;
            }

            const sessionData = await response.json();
            this.log(`Joined session: ${roomCode}`);

            this.currentSession = roomCode;
            this.gameState = { ...this.gameState, ...sessionData };

            // Switch to voting panel
            this.elements.joinPanel.classList.add('hidden');
            this.elements.votingPanel.classList.remove('hidden');

            // Update session info
            this.elements.currentSessionId.textContent = roomCode;

            // Connect WebSocket
            this.connectWebSocket();

            // Update UI based on current state
            this.updateGameState(sessionData);

        } catch (error) {
            this.log(`Error joining session: ${error.message}`, 'error');
            this.showJoinStatus('Connection error. Please try again.', 'error');
        } finally {
            this.elements.joinBtn.disabled = false;
            this.elements.joinBtn.textContent = 'Join Session';
        }
    }

    connectWebSocket() {
        if (!this.currentSession) return;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return; // Already connected
        }

        this.updateConnectionStatus('connecting');

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/session/${this.currentSession}/ws`;

            this.log(`Connecting to WebSocket: ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.log('WebSocket connected successfully');
                this.connectionAttempts = 0;
                this.updateConnectionStatus('connected');

                // Send join message
                this.sendMessage({
                    type: 'join',
                    userId: this.userId
                });
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    this.log(`Error parsing WebSocket message: ${error.message}`, 'error');
                }
            };

            this.ws.onclose = (event) => {
                this.log(`WebSocket closed: ${event.code} - ${event.reason}`);
                this.updateConnectionStatus('disconnected');
                if (this.currentSession) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (error) => {
                this.log(`WebSocket error: ${error}`, 'error');
                this.updateConnectionStatus('disconnected');
            };

        } catch (error) {
            this.log(`Failed to create WebSocket connection: ${error.message}`, 'error');
            this.updateConnectionStatus('disconnected');
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.connectionAttempts >= this.maxRetries) {
            this.log('Max reconnection attempts reached', 'error');
            return;
        }

        this.connectionAttempts++;
        const delay = this.retryDelay * this.connectionAttempts;

        this.log(`Reconnecting in ${delay}ms (attempt ${this.connectionAttempts}/${this.maxRetries})`);

        setTimeout(() => {
            this.connectWebSocket();
        }, delay);
    }

    checkWebSocketConnection() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.connectWebSocket();
        }
    }

    handleWebSocketMessage(message) {
        this.log(`Received: ${message.type}`, 'info');

        switch (message.type) {
            case 'gameState':
                this.updateGameState(message.data);
                break;
            case 'voteUpdate':
                this.updateVotes(message.data.votes);
                break;
            case 'slideChange':
                this.updateSlide(message.data.slideId);
                this.hasVoted = false; // Reset vote status for new slide
                this.updateVotingInterface();
                break;
            case 'pong':
                // Heartbeat response
                break;
            case 'error':
                this.log(`Server error: ${message.data.message}`, 'error');
                this.showVoteStatus(message.data.message, 'error');
                break;
            default:
                this.log(`Unknown message type: ${message.type}`, 'warning');
        }
    }

    updateGameState(state) {
        if (!state) return;

        this.gameState = { ...this.gameState, ...state };

        // Update session info
        if (state.sessionId) {
            this.elements.currentSessionId.textContent = state.sessionId;
        }

        // Update slide progress
        if (state.slideCount !== undefined) {
            this.elements.currentSlideNumber.textContent = state.slideCount;
        }
        if (state.maxSlides !== undefined) {
            this.elements.maxSlidesDisplay.textContent = state.maxSlides;
        }

        // Update phase
        if (state.phase) {
            this.updatePhase(state.phase, state.timeRemaining);
        }

        // Update votes
        if (state.votes) {
            this.updateVotes(state.votes);
        }

        // Update voting interface based on voting status
        this.updateVotingInterface();

        this.log(`Game state updated: ${state.phase} - slide ${state.slideCount}/${state.maxSlides}`);
    }

    updatePhase(phase, timeRemaining) {
        this.gameState.phase = phase;
        this.gameState.timeRemaining = timeRemaining || 0;

        const phaseMessages = {
            waiting: 'Waiting for game to start...',
            presenting: `Presentation in progress (${Math.ceil((timeRemaining || 0) / 1000)}s remaining)`,
            voting: 'Vote now for the next slide!',
            finished: 'Game finished! Thank you for participating.'
        };

        this.elements.phaseDisplay.textContent = phaseMessages[phase] || phase;

        // Show/hide appropriate interface sections
        if (phase === 'voting' && this.gameState.votingOpen) {
            this.elements.votingInterface.classList.remove('hidden');
            this.elements.waitingMessage.classList.add('hidden');
            this.elements.presentingMessage.classList.add('hidden');
        } else if (phase === 'presenting') {
            this.elements.votingInterface.classList.add('hidden');
            this.elements.waitingMessage.classList.add('hidden');
            this.elements.presentingMessage.classList.remove('hidden');

            // Update present time remaining
            if (timeRemaining) {
                this.updatePresentingTimer(timeRemaining);
            }
        } else {
            this.elements.votingInterface.classList.add('hidden');
            this.elements.waitingMessage.classList.remove('hidden');
            this.elements.presentingMessage.classList.add('hidden');
        }
    }

    updatePresentingTimer(timeRemaining) {
        const seconds = Math.ceil(timeRemaining / 1000);
        this.elements.presentTimeRemaining.textContent = seconds;

        // Update timer every second
        const timerInterval = setInterval(() => {
            const newSeconds = Math.ceil((timeRemaining - (Date.now() % 1000)) / 1000);
            if (newSeconds > 0) {
                this.elements.presentTimeRemaining.textContent = newSeconds;
            } else {
                clearInterval(timerInterval);
                this.elements.presentTimeRemaining.textContent = '0';
            }
        }, 1000);
    }

    updateVotes(votes) {
        if (!votes) return;

        this.gameState.votes = votes;
        this.elements.liveLogicalCount.textContent = votes.logical || 0;
        this.elements.liveChaoticCount.textContent = votes.chaotic || 0;
    }

    updateSlide(slideId) {
        if (slideId) {
            this.gameState.currentSlide = slideId;
        }
    }

    updateVotingInterface() {
        const canVote = this.gameState.phase === 'voting' &&
                       this.gameState.votingOpen &&
                       !this.hasVoted;

        this.elements.logicalBtn.disabled = !canVote;
        this.elements.chaoticBtn.disabled = !canVote;

        if (this.hasVoted) {
            this.showVoteStatus('Vote recorded! Thank you.', 'success');
        } else if (this.gameState.phase === 'voting' && !this.gameState.votingOpen) {
            this.showVoteStatus('Voting is closed for this round.', 'info');
        }
    }

    async vote(choice) {
        if (!this.currentSession || this.hasVoted) {
            return;
        }

        if (this.gameState.phase !== 'voting' || !this.gameState.votingOpen) {
            this.showVoteStatus('Voting is not currently open', 'error');
            return;
        }

        // Disable buttons immediately
        this.elements.logicalBtn.disabled = true;
        this.elements.chaoticBtn.disabled = true;

        // Show loading state
        const chosenBtn = choice === 'logical' ? this.elements.logicalBtn : this.elements.chaoticBtn;
        const originalText = chosenBtn.innerHTML;
        chosenBtn.innerHTML = '<div style="font-size: 18px;">⏳</div><div>Voting...</div>';

        try {
            const response = await fetch(`/session/${this.currentSession}/vote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId,
                    choice: choice
                })
            });

            const result = await response.json();

            if (result.success) {
                this.hasVoted = true;
                this.showVoteStatus(`✅ Vote cast for ${choice}!`, 'success');
                this.log(`Vote submitted: ${choice}`);

                // Update vote counts if provided
                if (result.currentVotes) {
                    this.updateVotes(result.currentVotes);
                }
            } else {
                this.showVoteStatus(`❌ ${result.error}`, 'error');
                this.updateVotingInterface(); // Re-enable buttons if vote failed
            }

        } catch (error) {
            this.log(`Vote error: ${error.message}`, 'error');
            this.showVoteStatus('❌ Connection error. Please try again.', 'error');
            this.updateVotingInterface(); // Re-enable buttons if vote failed
        } finally {
            // Restore button text
            chosenBtn.innerHTML = originalText;
        }
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.log('Cannot send message: WebSocket not connected', 'warning');
        }
    }

    showJoinStatus(message, type = 'info') {
        this.elements.joinStatus.className = `status status-${type}`;
        this.elements.joinStatus.textContent = message;
        this.elements.joinStatus.classList.remove('hidden');

        // Auto-hide after 5 seconds for non-error messages
        if (type !== 'error') {
            setTimeout(() => {
                this.elements.joinStatus.classList.add('hidden');
            }, 5000);
        }
    }

    showVoteStatus(message, type = 'info') {
        this.elements.voteStatus.className = `vote-status ${type}`;
        this.elements.voteStatus.textContent = message;
        this.elements.voteStatus.classList.remove('hidden');

        // Auto-hide after 3 seconds for success messages
        if (type === 'success') {
            setTimeout(() => {
                this.elements.voteStatus.classList.add('hidden');
            }, 3000);
        }
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

    log(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;

        if (level === 'error') {
            console.error(logMessage);
        } else if (level === 'warning') {
            console.warn(logMessage);
        } else {
            console.log(logMessage);
        }
    }
}

// Initialize vote controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.voteController = new VoteController();
});

// Send ping every 30 seconds to keep connection alive
setInterval(() => {
    if (window.voteController && window.voteController.ws &&
        window.voteController.ws.readyState === WebSocket.OPEN) {
        window.voteController.sendMessage({ type: 'ping' });
    }
}, 30000);