// Battle Decks - Display Interface JavaScript

class DisplayController {
    constructor() {
        // WebSocket connection
        this.ws = null;
        this.connectionAttempts = 0;
        this.maxRetries = 5;
        this.retryDelay = 1000;

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

        // Timer management
        this.timerInterval = null;
        this.timerStartTime = 0;
        this.timerDuration = 0;

        // DOM elements
        this.elements = {
            connectionStatus: document.getElementById('connectionStatus'),
            connectionIndicator: document.getElementById('connectionIndicator'),
            sessionId: document.getElementById('sessionId'),
            currentSlideNum: document.getElementById('currentSlideNum'),
            maxSlides: document.getElementById('maxSlides'),
            phaseIndicator: document.getElementById('phaseIndicator'),
            phaseLabel: document.getElementById('phaseLabel'),
            slideContainer: document.getElementById('slideContainer'),
            slidePlaceholder: document.getElementById('slidePlaceholder'),
            slideImage: document.getElementById('slideImage'),
            timerDisplay: document.getElementById('timerDisplay'),
            timerText: document.getElementById('timerText'),
            logicalCount: document.getElementById('logicalCount'),
            chaoticCount: document.getElementById('chaoticCount')
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.connectWebSocket();
        this.fetchInitialGameState();
        this.log('Display interface initialized');
    }

    setupEventListeners() {
        // Handle page visibility changes to maintain connection
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.log('Page hidden, maintaining WebSocket connection');
            } else {
                this.log('Page visible, checking WebSocket connection');
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    this.connectWebSocket();
                }
            }
        });

        // Handle window focus
        window.addEventListener('focus', () => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.connectWebSocket();
            }
        });
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return; // Already connected
        }

        this.updateConnectionStatus('connecting');

        // Get session ID from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('session');

        if (!sessionId) {
            this.log('No session ID in URL parameters. Use ?session=SESSION_ID', 'error');
            this.updateConnectionStatus('disconnected');
            return;
        }

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/session/${sessionId}/ws`;

            this.log(`Connecting to WebSocket: ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.log('WebSocket connected successfully');
                this.connectionAttempts = 0;
                this.updateConnectionStatus('connected');

                // Send join message
                this.sendMessage({
                    type: 'join',
                    userId: 'display_' + Math.random().toString(36).substring(2, 11)
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
                this.scheduleReconnect();
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

    handleWebSocketMessage(message) {
        this.log(`📨 Received: ${message.type} at ${new Date().toLocaleTimeString()}`, 'info');

        switch (message.type) {
            case 'gameState':
                this.log(`🎮 Game state update - Phase: ${message.data?.phase}, Slide: ${message.data?.slideCount}/${message.data?.maxSlides}`, 'info');
                this.updateGameState(message.data);
                break;
            case 'voteUpdate':
                this.log(`🗳️ Vote update - Logical: ${message.data.votes?.logical}, Chaotic: ${message.data.votes?.chaotic}`, 'info');
                this.updateVotes(message.data.votes);
                break;
            case 'slideChange':
                this.log(`📄 Slide change to: ${message.data.slideId}`, 'info');
                this.updateSlide(message.data.slideId);
                break;
            case 'timerUpdate':
                this.updateTimer(message.data);
                break;
            case 'pong':
                // Heartbeat response
                break;
            case 'error':
                this.log(`❌ Server error: ${message.data.message}`, 'error');
                break;
            default:
                this.log(`⚠️ Unknown message type: ${message.type}`, 'warning');
        }
    }

    updateGameState(state) {
        if (!state) return;

        this.gameState = { ...this.gameState, ...state };

        // Update session info
        if (state.sessionId) {
            this.elements.sessionId.textContent = state.sessionId;
        }

        // Update slide progress
        if (state.slideCount !== undefined) {
            this.elements.currentSlideNum.textContent = state.slideCount;
        }
        if (state.maxSlides !== undefined) {
            this.elements.maxSlides.textContent = state.maxSlides;
        }

        // Update phase
        if (state.phase) {
            this.updatePhase(state.phase);
        }

        // Update votes
        if (state.votes) {
            this.updateVotes(state.votes);
        }

        // Update slide
        if (state.currentSlide) {
            this.updateSlide(state.currentSlide);
        }

        // Update timer
        if (state.timeRemaining !== undefined) {
            this.startTimer(state.timeRemaining);
        }

        this.log(`Game state updated: ${state.phase} - slide ${state.slideCount}/${state.maxSlides}`);
    }

    updatePhase(phase) {
        const previousPhase = this.gameState.phase;
        this.gameState.phase = phase;

        if (previousPhase !== phase) {
            this.log(`🔄 Phase transition: ${previousPhase} → ${phase}`, 'info');
        }

        // Update phase indicator
        this.elements.phaseIndicator.className = `phase-indicator phase-${phase}`;

        const phaseLabels = {
            waiting: 'Waiting',
            presenting: 'Presenting',
            voting: 'Voting',
            finished: 'Finished'
        };

        this.elements.phaseIndicator.textContent = phaseLabels[phase] || phase;
        this.elements.phaseLabel.textContent = phaseLabels[phase] || phase;

        // Update timer display style based on phase
        if (phase === 'voting') {
            this.elements.timerDisplay.classList.add('warning');
            this.elements.timerDisplay.classList.remove('danger');
        } else if (phase === 'finished') {
            this.elements.timerDisplay.classList.add('danger');
            this.elements.timerDisplay.classList.remove('warning');
        } else {
            this.elements.timerDisplay.classList.remove('warning', 'danger');
        }

        // Hide timer and voting sections when game is finished
        const voteDisplay = document.getElementById('voteDisplay');

        if (phase === 'finished') {
            // Hide timer and voting displays
            this.elements.timerDisplay.style.display = 'none';
            if (voteDisplay) voteDisplay.style.display = 'none';

            // Show game completion message
            this.showGameCompletionMessage();

            this.log('🏁 Game completed - timer and voting hidden', 'info');
        } else {
            // Show timer and voting displays for other phases
            this.elements.timerDisplay.style.display = 'flex';
            if (voteDisplay) voteDisplay.style.display = 'grid';

            // Hide any completion message
            this.hideGameCompletionMessage();
        }
    }

    updateVotes(votes) {
        if (!votes) return;

        this.gameState.votes = votes;
        this.elements.logicalCount.textContent = votes.logical || 0;
        this.elements.chaoticCount.textContent = votes.chaotic || 0;
    }

    updateSlide(slideId) {
        if (!slideId) return;

        this.gameState.currentSlide = slideId;

        // Try to load slide image
        const imageUrl = `/slides/${slideId}.jpg`;

        // Create a new image to test if it loads
        const testImage = new Image();
        testImage.onload = () => {
            // Image loaded successfully
            this.elements.slideImage.src = imageUrl;
            this.elements.slideImage.classList.remove('hidden');
            this.elements.slidePlaceholder.classList.add('hidden');
            this.log(`Loaded slide image: ${slideId}`);
        };

        testImage.onerror = () => {
            // Image failed to load, show placeholder
            this.elements.slideImage.classList.add('hidden');
            this.elements.slidePlaceholder.classList.remove('hidden');
            this.elements.slidePlaceholder.innerHTML = `
                <div>📄 ${slideId}</div>
                <div style="font-size: 24px; margin-top: 20px; opacity: 0.6;">
                    Slide content would appear here
                </div>
            `;
            this.log(`Using placeholder for slide: ${slideId}`);
        };

        testImage.src = imageUrl;
    }

    startTimer(timeRemaining) {
        this.clearTimer();

        if (timeRemaining <= 0) {
            this.elements.timerText.textContent = '0';
            this.updateTimerVisual(0);
            return;
        }

        this.timerStartTime = Date.now();
        this.timerDuration = timeRemaining;

        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.timerStartTime;
            const remaining = Math.max(0, this.timerDuration - elapsed);

            if (remaining <= 0) {
                this.clearTimer();
                this.elements.timerText.textContent = '0';
                this.updateTimerVisual(0);
                return;
            }

            const seconds = Math.ceil(remaining / 1000);
            this.elements.timerText.textContent = seconds.toString();
            this.updateTimerVisual(remaining / this.timerDuration);

            // Change timer style based on remaining time
            if (seconds <= 5) {
                this.elements.timerDisplay.classList.add('danger');
                this.elements.timerDisplay.classList.remove('warning');
            } else if (seconds <= 10) {
                this.elements.timerDisplay.classList.add('warning');
                this.elements.timerDisplay.classList.remove('danger');
            } else {
                this.elements.timerDisplay.classList.remove('warning', 'danger');
            }
        }, 100);
    }

    updateTimerVisual(progress) {
        // Update circular progress background
        const degrees = progress * 360;
        const color = this.elements.timerDisplay.classList.contains('danger') ? 'var(--danger-color)' :
                     this.elements.timerDisplay.classList.contains('warning') ? 'var(--warning-color)' :
                     'var(--primary-color)';

        this.elements.timerDisplay.style.background =
            `conic-gradient(${color} ${degrees}deg, rgba(255,255,255,0.2) ${degrees}deg)`;
    }

    clearTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.log('Cannot send message: WebSocket not connected', 'warning');
        }
    }

    updateConnectionStatus(status) {
        const statusElement = this.elements.connectionStatus;
        const indicatorElement = this.elements.connectionIndicator;

        statusElement.className = `connection-status ${status}`;

        switch (status) {
            case 'connected':
                statusElement.textContent = 'Connected';
                indicatorElement.textContent = '●';
                indicatorElement.style.color = 'var(--success-color)';
                break;
            case 'connecting':
                statusElement.textContent = 'Connecting...';
                indicatorElement.textContent = '●';
                indicatorElement.style.color = 'var(--warning-color)';
                break;
            case 'disconnected':
                statusElement.textContent = 'Disconnected';
                indicatorElement.textContent = '●';
                indicatorElement.style.color = 'var(--danger-color)';
                break;
        }
    }

    async fetchInitialGameState() {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('session');

        if (!sessionId) {
            return;
        }

        try {
            const response = await fetch(`/session/${sessionId}/status`);
            if (response.ok) {
                const gameState = await response.json();
                this.updateGameState(gameState);
                this.log(`Initial game state loaded for session ${sessionId}`);
            } else {
                this.log(`Session ${sessionId} not found or not started yet`, 'warning');
            }
        } catch (error) {
            this.log(`Error fetching initial game state: ${error.message}`, 'error');
        }
    }

    showGameCompletionMessage() {
        // Remove existing completion message if present
        this.hideGameCompletionMessage();

        // Create completion message element
        const completionContainer = document.createElement('div');
        completionContainer.id = 'gameCompletionMessage';
        completionContainer.style.cssText = `
            text-align: center;
            padding: 20px;
            background: linear-gradient(135deg, #4CAF50, #45a049);
            border-radius: 12px;
            color: white;
            font-size: 18px;
            font-weight: 600;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            animation: slideIn 0.5s ease-out;
        `;

        const totalVotes = (this.gameState.votes?.logical || 0) + (this.gameState.votes?.chaotic || 0);
        completionContainer.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 8px;">🎉 Game Complete! 🎉</div>
            <div style="opacity: 0.9;">
                Presented ${this.gameState.slideCount}/${this.gameState.maxSlides} slides
            </div>
            <div style="opacity: 0.9; margin-top: 4px;">
                Total votes: ${totalVotes}
            </div>
        `;

        // Insert where the timer was
        const timerContainer = this.elements.timerDisplay.parentElement;
        if (timerContainer) {
            timerContainer.appendChild(completionContainer);
        }
    }

    hideGameCompletionMessage() {
        const existingMessage = document.getElementById('gameCompletionMessage');
        if (existingMessage) {
            existingMessage.remove();
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

// Initialize display controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.displayController = new DisplayController();
});

// Send ping every 30 seconds to keep connection alive
setInterval(() => {
    if (window.displayController && window.displayController.ws &&
        window.displayController.ws.readyState === WebSocket.OPEN) {
        window.displayController.sendMessage({ type: 'ping' });
    }
}, 30000);