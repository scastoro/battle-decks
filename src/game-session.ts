import {
  GameState,
  GamePhase,
  VoteChoice,
  VoteResult,
  GameStatusResponse,
  WebSocketMessage,
  AdjacencyRecord,
  GameRecord,
  ConnectionMetadata
} from './types/index';

export class GameSession {
  private sql: SqlStorage;
  private ctx: DurableObjectState;
  private env: Env;

  // In-memory game state (rebuilt from SQLite on hibernation wake-up)
  private gameState: GameState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;

    // Initialize SQLite tables
    this.initializeTables();
  }

  private initializeTables(): void {
    // Table for slide adjacency data (pre-computed relationships)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS adjacency (
        slide_id TEXT PRIMARY KEY,
        logical_slides TEXT NOT NULL,
        chaotic_slides TEXT NOT NULL
      )
    `);

    // Table for game session data (persistent across hibernation)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS game_session (
        session_id TEXT PRIMARY KEY,
        current_slide TEXT NOT NULL,
        used_slides TEXT NOT NULL,
        phase TEXT NOT NULL,
        slide_count INTEGER NOT NULL,
        max_slides INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Optimize SQLite performance (2025 best practice)
    this.sql.exec('PRAGMA optimize');

    // Load mock data if tables are empty (for MVP)
    this.loadMockDataIfNeeded();
  }

  private loadMockDataIfNeeded(): void {
    const count = this.sql.exec('SELECT COUNT(*) as count FROM adjacency').one() as { count: number };
    if (count.count === 0) {
      this.loadMockSlideData();
    }
  }

  private loadMockSlideData(): void {
    // Mock slide data for MVP testing
    const mockSlides = [
      {
        id: 'slide_1',
        logical: ['slide_2', 'slide_3', 'slide_4'],
        chaotic: ['slide_8', 'slide_9', 'slide_10']
      },
      {
        id: 'slide_2',
        logical: ['slide_1', 'slide_3', 'slide_5'],
        chaotic: ['slide_7', 'slide_9', 'slide_10']
      },
      {
        id: 'slide_3',
        logical: ['slide_1', 'slide_2', 'slide_6'],
        chaotic: ['slide_8', 'slide_10', 'slide_7']
      },
      {
        id: 'slide_4',
        logical: ['slide_1', 'slide_5', 'slide_6'],
        chaotic: ['slide_9', 'slide_10', 'slide_8']
      },
      {
        id: 'slide_5',
        logical: ['slide_2', 'slide_4', 'slide_6'],
        chaotic: ['slide_7', 'slide_8', 'slide_10']
      },
      {
        id: 'slide_6',
        logical: ['slide_3', 'slide_4', 'slide_5'],
        chaotic: ['slide_7', 'slide_8', 'slide_9']
      },
      {
        id: 'slide_7',
        logical: ['slide_8', 'slide_9', 'slide_10'],
        chaotic: ['slide_1', 'slide_2', 'slide_3']
      },
      {
        id: 'slide_8',
        logical: ['slide_7', 'slide_9', 'slide_10'],
        chaotic: ['slide_1', 'slide_3', 'slide_4']
      },
      {
        id: 'slide_9',
        logical: ['slide_7', 'slide_8', 'slide_10'],
        chaotic: ['slide_2', 'slide_4', 'slide_5']
      },
      {
        id: 'slide_10',
        logical: ['slide_7', 'slide_8', 'slide_9'],
        chaotic: ['slide_3', 'slide_5', 'slide_6']
      }
    ];

    for (const slide of mockSlides) {
      this.sql.exec(
        'INSERT INTO adjacency (slide_id, logical_slides, chaotic_slides) VALUES (?, ?, ?)',
        slide.id,
        JSON.stringify(slide.logical),
        JSON.stringify(slide.chaotic)
      );
    }
  }

  // RPC method: Initialize a new game session
  async initialize(): Promise<Response> {
    const sessionId = this.ctx.id.toString();

    this.gameState = {
      sessionId,
      currentSlide: 'slide_1',
      usedSlides: new Set(['slide_1']),
      phase: 'waiting',
      votes: { logical: 0, chaotic: 0 },
      voters: new Set(),
      votingOpen: false,
      timerEnd: 0,
      slideCount: 1,
      maxSlides: 10
    };

    await this.saveGameState();

    return new Response(JSON.stringify({
      success: true,
      sessionId
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // RPC method: Start the game
  async startGame(deckId: string, maxSlides: number = 10): Promise<Response> {
    await this.ensureGameStateLoaded();

    if (!this.gameState) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Session not initialized'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    this.gameState.phase = 'presenting';
    this.gameState.maxSlides = maxSlides;
    this.gameState.timerEnd = Date.now() + 45000; // 45 seconds

    await this.saveGameState();
    this.startPresentationTimer();
    this.broadcastGameState();

    return new Response(JSON.stringify({
      success: true,
      gameState: this.getPublicGameState()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // RPC method: Submit a vote
  async vote(userId: string, choice: VoteChoice): Promise<Response> {
    await this.ensureGameStateLoaded();

    if (!this.gameState || !this.gameState.votingOpen) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Voting is not currently open'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (this.gameState.voters.has(userId)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'User has already voted'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Record the vote
    this.gameState.votes[choice]++;
    this.gameState.voters.add(userId);

    // Broadcast vote update to all connected clients
    this.broadcastVoteUpdate();

    return new Response(JSON.stringify({
      success: true,
      currentVotes: this.gameState.votes
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // RPC method: Get current game status
  async getStatus(): Promise<Response> {
    await this.ensureGameStateLoaded();

    if (!this.gameState) {
      return new Response(JSON.stringify({
        error: 'Session not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const response: GameStatusResponse = {
      sessionId: this.gameState.sessionId,
      currentSlide: this.gameState.currentSlide,
      phase: this.gameState.phase,
      votes: this.gameState.votes,
      timeRemaining: Math.max(0, this.gameState.timerEnd - Date.now()),
      slideCount: this.gameState.slideCount,
      votingOpen: this.gameState.votingOpen
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Handle WebSocket connections with Hibernation API
  async handleWebSocket(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Use WebSocket Hibernation API (2025 best practice)
    this.ctx.acceptWebSocket(server);

    // Attach metadata to WebSocket for hibernation persistence
    const metadata: ConnectionMetadata = {
      joinedAt: Date.now(),
      lastActivity: Date.now()
    };

    // Store metadata in a way that survives hibernation
    server.serializeAttachment(metadata);

    // Set up auto-response for ping/pong (avoids waking hibernating DO)
    const pingRequest = new Request('ws://ping');
    const pongResponse = new Response('pong');
    this.ctx.setWebSocketAutoResponse(pingRequest, pongResponse);

    // Send current game state to new client
    await this.ensureGameStateLoaded();
    if (this.gameState) {
      this.sendToSocket(server, {
        type: 'gameState',
        data: this.getPublicGameState(),
        timestamp: Date.now()
      });
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // WebSocket message handler (called when DO wakes from hibernation)
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      // Ensure game state is loaded (important after hibernation)
      await this.ensureGameStateLoaded();

      const data = JSON.parse(message);

      // Update last activity
      const metadata = ws.deserializeAttachment() as ConnectionMetadata;
      metadata.lastActivity = Date.now();
      ws.serializeAttachment(metadata);

      // Handle different message types
      switch (data.type) {
        case 'ping':
          this.sendToSocket(ws, {
            type: 'pong',
            data: { timestamp: Date.now() },
            timestamp: Date.now()
          });
          break;

        case 'join':
          // Handle user joining
          if (data.userId) {
            metadata.userId = data.userId;
            ws.serializeAttachment(metadata);
          }
          break;

        default:
          console.log('Unknown WebSocket message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      this.sendToSocket(ws, {
        type: 'error',
        data: { message: 'Failed to process message' },
        timestamp: Date.now()
      });
    }
  }

  // WebSocket close handler
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Clean up any resources if needed
    // Note: Don't rely on this for critical cleanup since it may not always be called
  }

  // Alarm handler for game timers
  async alarm(): Promise<void> {
    await this.ensureGameStateLoaded();
    if (!this.gameState) return;

    if (this.gameState.phase === 'presenting') {
      // Switch to voting phase
      this.gameState.phase = 'voting';
      this.startVotingTimer();
    } else if (this.gameState.phase === 'voting') {
      // Process votes and move to next slide
      await this.processVotesAndAdvance();
    }
  }

  // Ensure game state is loaded from SQLite (important after hibernation)
  private async ensureGameStateLoaded(): Promise<void> {
    if (!this.gameState) {
      await this.loadGameState();
    }
  }

  private async saveGameState(): Promise<void> {
    if (!this.gameState) return;

    this.sql.exec(`
      INSERT OR REPLACE INTO game_session
      (session_id, current_slide, used_slides, phase, slide_count, max_slides, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      this.gameState.sessionId,
      this.gameState.currentSlide,
      JSON.stringify(Array.from(this.gameState.usedSlides)),
      this.gameState.phase,
      this.gameState.slideCount,
      this.gameState.maxSlides,
      Date.now(),
      Date.now()
    );
  }

  private async loadGameState(): Promise<void> {
    const result = this.sql.exec(
      'SELECT * FROM game_session ORDER BY updated_at DESC LIMIT 1'
    ).one() as GameRecord | null;

    if (result) {
      this.gameState = {
        sessionId: result.session_id,
        currentSlide: result.current_slide,
        usedSlides: new Set(JSON.parse(result.used_slides)),
        phase: result.phase as GamePhase,
        votes: { logical: 0, chaotic: 0 },
        voters: new Set(),
        votingOpen: false,
        timerEnd: 0,
        slideCount: result.slide_count,
        maxSlides: result.max_slides
      };
    }
  }

  private startPresentationTimer(): void {
    this.ctx.storage.setAlarm(Date.now() + 45000);
  }

  private startVotingTimer(): void {
    this.gameState!.votingOpen = true;
    this.gameState!.voters.clear();
    this.gameState!.votes = { logical: 0, chaotic: 0 };
    this.ctx.storage.setAlarm(Date.now() + 10000);
    this.broadcastGameState();
  }

  private async processVotesAndAdvance(): Promise<void> {
    if (!this.gameState) return;

    this.gameState.votingOpen = false;

    // Determine winner
    const winner = this.gameState.votes.logical > this.gameState.votes.chaotic ? 'logical' : 'chaotic';

    // Get next slide options
    const nextSlide = this.getNextSlide(winner);

    if (!nextSlide || this.gameState.slideCount >= this.gameState.maxSlides) {
      // Game finished
      this.gameState.phase = 'finished';
      this.broadcastGameState();
      await this.saveGameState();
      return;
    }

    // Advance to next slide
    this.gameState.currentSlide = nextSlide;
    this.gameState.usedSlides.add(nextSlide);
    this.gameState.slideCount++;
    this.gameState.phase = 'presenting';
    this.gameState.timerEnd = Date.now() + 45000;

    await this.saveGameState();
    this.startPresentationTimer();
    this.broadcastSlideChange(nextSlide);
  }

  private getNextSlide(choice: VoteChoice): string | null {
    if (!this.gameState) return null;

    const adjacency = this.sql.exec(
      'SELECT * FROM adjacency WHERE slide_id = ?',
      this.gameState.currentSlide
    ).one() as AdjacencyRecord | null;

    if (!adjacency) return null;

    const options = choice === 'logical'
      ? JSON.parse(adjacency.logical_slides)
      : JSON.parse(adjacency.chaotic_slides);

    // Find first unused slide
    for (const slideId of options) {
      if (!this.gameState.usedSlides.has(slideId)) {
        return slideId;
      }
    }

    return null;
  }

  private getPublicGameState() {
    if (!this.gameState) return null;

    return {
      sessionId: this.gameState.sessionId,
      currentSlide: this.gameState.currentSlide,
      phase: this.gameState.phase,
      votes: this.gameState.votes,
      timeRemaining: Math.max(0, this.gameState.timerEnd - Date.now()),
      slideCount: this.gameState.slideCount,
      maxSlides: this.gameState.maxSlides,
      votingOpen: this.gameState.votingOpen
    };
  }

  private broadcastGameState(): void {
    this.broadcast({
      type: 'gameState',
      data: this.getPublicGameState(),
      timestamp: Date.now()
    });
  }

  private broadcastVoteUpdate(): void {
    this.broadcast({
      type: 'voteUpdate',
      data: { votes: this.gameState?.votes },
      timestamp: Date.now()
    });
  }

  private broadcastSlideChange(slideId: string): void {
    this.broadcast({
      type: 'slideChange',
      data: { slideId },
      timestamp: Date.now()
    });
  }

  private broadcast(message: WebSocketMessage): void {
    const messageStr = JSON.stringify(message);

    // Get all hibernatable WebSockets
    this.ctx.getWebSockets().forEach(ws => {
      try {
        ws.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting to socket:', error);
      }
    });
  }

  private sendToSocket(socket: WebSocket, message: WebSocketMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending to socket:', error);
    }
  }
}