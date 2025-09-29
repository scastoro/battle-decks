import { DurableObject } from "cloudflare:workers";
import {
  Env,
  GameState,
  GamePhase,
  VoteChoice,
  VoteResult,
  GameStatusResponse,
  WebSocketMessage,
  AdjacencyRecord,
  GameRecord,
  ConnectionMetadata,
  SqlRow,
  isGameRecord,
  isAdjacencyRecord
} from './types/index';

export class GameSession extends DurableObject<Env> {
  private sql: SqlStorage;

  // In-memory game state (rebuilt from SQLite on hibernation wake-up)
  private gameState: GameState | null = null;

  // Store room code for consistent session lookup
  private roomCode: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env); // Required for RPC support
    this.sql = ctx.storage.sql;

    // Initialize SQLite tables and recover room code (CRITICAL: prevents race conditions)
    this.ctx.blockConcurrencyWhile(async () => {
      this.initializeTables();
      await this.recoverRoomCodeFromStorage();
    });
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
        timer_end INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Table for DO metadata persistence (CRITICAL: solves alarm handler issue)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS do_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Optimize SQLite performance (2025 best practice)
    this.sql.exec('PRAGMA optimize');

    // Load mock data if tables are empty (for MVP)
    this.loadMockDataIfNeeded();
  }

  private loadMockDataIfNeeded(): void {
    // Only load mock data if there's no real deck data
    // This is kept for backwards compatibility and testing
    const count = this.sql.exec('SELECT COUNT(*) as count FROM adjacency').one() as { count: number };
    if (count.count === 0) {
      console.log('⚠️ No adjacency data found, loading mock data for testing');
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

  // Fetch method to handle HTTP requests including WebSocket upgrades
  async fetch(request: Request): Promise<Response> {
    // Check if this is a WebSocket upgrade request
    const upgradeHeader = request.headers.get('Upgrade');

    if (upgradeHeader === 'websocket') {
      // Handle WebSocket upgrade
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      // Accept the WebSocket using hibernation API
      this.ctx.acceptWebSocket(server);
      console.log(`🔌 WebSocket accepted! Total WebSockets: ${this.ctx.getWebSockets().length}`);

      // Attach metadata to WebSocket for hibernation persistence
      const metadata: ConnectionMetadata = {
        joinedAt: Date.now(),
        lastActivity: Date.now()
      };

      // Store metadata in a way that survives hibernation
      server.serializeAttachment(metadata);

      // Send initial game state
      await this.ensureGameStateLoaded();
      if (this.gameState) {
        console.log(`📤 Sending initial game state to new WebSocket client`);
        this.sendToSocket(server, {
          type: 'gameState',
          data: this.getPublicGameState(),
          timestamp: Date.now()
        });
      }

      return new Response(null, {
        status: 101,
        webSocket: client
      } as ResponseInit & { webSocket: WebSocket });
    }

    // Non-WebSocket requests
    return new Response('Not found', { status: 404 });
  }

  // RPC method: Initialize a new game session
  async initialize(roomCode?: string): Promise<Response> {
    const sessionId = roomCode || this.ctx.id.toString();
    this.roomCode = roomCode || null;

    // CRITICAL: Store room code persistently for alarm handler recovery
    if (roomCode) {
      await this.storeRoomCode(roomCode);
    }

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

    // Load deck data from KV if deckId is provided
    if (deckId && deckId !== 'default') {
      console.log(`📦 Loading deck data for: ${deckId}`);

      try {
        // Check if deck exists and is ready
        const metadataJson = await this.env.DECKS.get(`deck:${deckId}:metadata`);
        if (!metadataJson) {
          return new Response(JSON.stringify({
            success: false,
            error: `Deck not found: ${deckId}`
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const metadata = JSON.parse(metadataJson);
        if (metadata.status !== 'ready') {
          return new Response(JSON.stringify({
            success: false,
            error: `Deck is not ready. Current status: ${metadata.status}`
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Load adjacency list from KV
        const adjacencyJson = await this.env.DECKS.get(`deck:${deckId}:adjacency`);
        if (!adjacencyJson) {
          return new Response(JSON.stringify({
            success: false,
            error: `Deck adjacency data not found for: ${deckId}`
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const adjacencyData = JSON.parse(adjacencyJson) as Record<string, { logical: string[]; chaotic: string[] }>;

        // Clear existing adjacency data
        this.sql.exec('DELETE FROM adjacency');

        // Load deck adjacency data into SQLite
        for (const [slideId, neighbors] of Object.entries(adjacencyData)) {
          this.sql.exec(
            'INSERT INTO adjacency (slide_id, logical_slides, chaotic_slides) VALUES (?, ?, ?)',
            slideId,
            JSON.stringify(neighbors.logical),
            JSON.stringify(neighbors.chaotic)
          );
        }

        console.log(`✅ Loaded ${Object.keys(adjacencyData).length} slides from deck ${deckId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error loading deck ${deckId}:`, errorMessage);
        return new Response(JSON.stringify({
          success: false,
          error: `Failed to load deck: ${errorMessage}`
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      console.log('⚠️ Using default/mock deck data');
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
    try {
      console.log('🔔 Alarm handler triggered, checking room code...');

      // SOLUTION: Ensure room code is recovered after DO restart
      if (!this.roomCode) {
        await this.recoverRoomCodeFromStorage();
      }

      console.log(`🔔 Room code status: ${this.roomCode ? `Found: ${this.roomCode}` : 'Not found, using DO ID'}`);

      await this.ensureGameStateLoaded();
      if (!this.gameState) {
        console.error('❌ Alarm handler: No game state found, cannot proceed');
        return;
      }

      console.log(`🔔 Processing alarm for session ${this.gameState.sessionId}, phase: ${this.gameState.phase}`);

      if (this.gameState.phase === 'presenting') {
        // Check if this is the final slide
        if (this.gameState.slideCount >= this.gameState.maxSlides) {
          // Game is complete - skip voting and go directly to finished
          console.log(`🏁 Game complete! Final slide ${this.gameState.slideCount}/${this.gameState.maxSlides} - skipping voting`);
          this.gameState.phase = 'finished';
          this.gameState.timeRemaining = 0;
          await this.saveGameState();
          await this.broadcastGameState();
        } else {
          // Switch to voting phase
          this.gameState.phase = 'voting';
          await this.saveGameState(); // CRITICAL: Save state changes to database
          await this.startVotingTimer();
        }
      } else if (this.gameState.phase === 'voting') {
        // Process votes and move to next slide
        await this.processVotesAndAdvance();
      }
    } catch (error) {
      console.error('❌ Critical error in alarm handler:', error);
      // Don't throw - let the alarm retry with exponential backoff
    }
  }

  // SOLUTION: Store room code persistently for alarm handler recovery
  private async storeRoomCode(roomCode: string): Promise<void> {
    this.sql.exec(
      'INSERT OR REPLACE INTO do_metadata (key, value, created_at) VALUES (?, ?, ?)',
      'room_code',
      roomCode,
      Date.now()
    );
  }

  // SOLUTION: Recover room code from storage after DO restart
  private async recoverRoomCodeFromStorage(): Promise<void> {
    try {
      const result = this.sql.exec('SELECT value FROM do_metadata WHERE key = ?', 'room_code').one() as { value: string } | null;
      if (result) {
        this.roomCode = result.value;
        console.log(`✅ Recovered room code: ${this.roomCode} after DO restart`);
      } else {
        console.log('ℹ️ No stored room code found (expected for new DO)');
      }
    } catch (error) {
      // This is expected for new DOs or DOs created before this fix
      console.log('ℹ️ No room code metadata table found (expected for new/legacy DO)', error);
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
      (session_id, current_slide, used_slides, phase, slide_count, max_slides, timer_end, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      this.gameState.sessionId,
      this.gameState.currentSlide,
      JSON.stringify(Array.from(this.gameState.usedSlides)),
      this.gameState.phase,
      this.gameState.slideCount,
      this.gameState.maxSlides,
      this.gameState.timerEnd,
      Date.now(),
      Date.now()
    );
  }

  private async loadGameState(): Promise<void> {
    try {
      // CRITICAL FIX: Use recovered room code or fallback to DO ID
      let sessionId = this.roomCode;

      // If no room code, try to recover it first
      if (!sessionId) {
        await this.recoverRoomCodeFromStorage();
        sessionId = this.roomCode;
      }

      // Final fallback to DO ID (for backwards compatibility)
      sessionId = sessionId || this.ctx.id.toString();

      const result = this.sql.exec(
        'SELECT * FROM game_session WHERE session_id = ? LIMIT 1',
        sessionId
      ).one() as SqlRow | null;

    if (result && isGameRecord(result)) {
      // Restore room code for future lookups (ensure consistency)
      if (!this.roomCode && result.session_id !== this.ctx.id.toString()) {
        this.roomCode = result.session_id;
        await this.storeRoomCode(result.session_id); // Persist for future recovery
      }

      this.gameState = {
        sessionId: result.session_id,
        currentSlide: result.current_slide,
        usedSlides: new Set(JSON.parse(result.used_slides)),
        phase: result.phase as GamePhase,
        votes: { logical: 0, chaotic: 0 },
        voters: new Set(),
        votingOpen: false,
        timerEnd: result.timer_end,
        slideCount: result.slide_count,
        maxSlides: result.max_slides
      };
    }
    } catch (error) {
      // If there's an error loading game state (e.g., no session found),
      // gameState will remain null, which is handled by calling methods
      console.error('Error loading game state:', error);
    }
  }

  private startPresentationTimer(): void {
    this.ctx.storage.setAlarm(Date.now() + 45000);
  }

  private async startVotingTimer(): Promise<void> {
    this.gameState!.votingOpen = true;
    this.gameState!.voters.clear();
    this.gameState!.votes = { logical: 0, chaotic: 0 };
    this.gameState!.timerEnd = Date.now() + 10000; // 10 seconds for voting
    await this.saveGameState(); // CRITICAL: Save state changes to database
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
    this.broadcastGameState(); // Ensure all clients get updated phase and slide info
    this.broadcastSlideChange(nextSlide);
  }

  private getNextSlide(choice: VoteChoice): string | null {
    if (!this.gameState) return null;

    const result = this.sql.exec(
      'SELECT * FROM adjacency WHERE slide_id = ?',
      this.gameState.currentSlide
    ).one() as SqlRow | null;

    if (!result || !isAdjacencyRecord(result)) return null;

    const options = choice === 'logical'
      ? JSON.parse(result.logical_slides)
      : JSON.parse(result.chaotic_slides);

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
    const webSockets = this.ctx.getWebSockets();

    console.log(`📡 Broadcasting ${message.type} to ${webSockets.length} WebSocket(s)`);

    // Get all hibernatable WebSockets
    webSockets.forEach((ws, index) => {
      try {
        ws.send(messageStr);
        console.log(`✅ Sent ${message.type} to WebSocket ${index + 1}`);
      } catch (error) {
        console.error(`❌ Error broadcasting ${message.type} to WebSocket ${index + 1}:`, error);
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