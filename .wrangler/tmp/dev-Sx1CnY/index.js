var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/game-session.ts
var GameSession = class {
  static {
    __name(this, "GameSession");
  }
  sql;
  ctx;
  env;
  // In-memory game state (rebuilt from SQLite on hibernation wake-up)
  gameState = null;
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.initializeTables();
  }
  initializeTables() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS adjacency (
        slide_id TEXT PRIMARY KEY,
        logical_slides TEXT NOT NULL,
        chaotic_slides TEXT NOT NULL
      )
    `);
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
    this.sql.exec("PRAGMA optimize");
    this.loadMockDataIfNeeded();
  }
  loadMockDataIfNeeded() {
    const count = this.sql.exec("SELECT COUNT(*) as count FROM adjacency").one();
    if (count.count === 0) {
      this.loadMockSlideData();
    }
  }
  loadMockSlideData() {
    const mockSlides = [
      {
        id: "slide_1",
        logical: ["slide_2", "slide_3", "slide_4"],
        chaotic: ["slide_8", "slide_9", "slide_10"]
      },
      {
        id: "slide_2",
        logical: ["slide_1", "slide_3", "slide_5"],
        chaotic: ["slide_7", "slide_9", "slide_10"]
      },
      {
        id: "slide_3",
        logical: ["slide_1", "slide_2", "slide_6"],
        chaotic: ["slide_8", "slide_10", "slide_7"]
      },
      {
        id: "slide_4",
        logical: ["slide_1", "slide_5", "slide_6"],
        chaotic: ["slide_9", "slide_10", "slide_8"]
      },
      {
        id: "slide_5",
        logical: ["slide_2", "slide_4", "slide_6"],
        chaotic: ["slide_7", "slide_8", "slide_10"]
      },
      {
        id: "slide_6",
        logical: ["slide_3", "slide_4", "slide_5"],
        chaotic: ["slide_7", "slide_8", "slide_9"]
      },
      {
        id: "slide_7",
        logical: ["slide_8", "slide_9", "slide_10"],
        chaotic: ["slide_1", "slide_2", "slide_3"]
      },
      {
        id: "slide_8",
        logical: ["slide_7", "slide_9", "slide_10"],
        chaotic: ["slide_1", "slide_3", "slide_4"]
      },
      {
        id: "slide_9",
        logical: ["slide_7", "slide_8", "slide_10"],
        chaotic: ["slide_2", "slide_4", "slide_5"]
      },
      {
        id: "slide_10",
        logical: ["slide_7", "slide_8", "slide_9"],
        chaotic: ["slide_3", "slide_5", "slide_6"]
      }
    ];
    for (const slide of mockSlides) {
      this.sql.exec(
        "INSERT INTO adjacency (slide_id, logical_slides, chaotic_slides) VALUES (?, ?, ?)",
        slide.id,
        JSON.stringify(slide.logical),
        JSON.stringify(slide.chaotic)
      );
    }
  }
  // RPC method: Initialize a new game session
  async initialize() {
    const sessionId = this.ctx.id.toString();
    this.gameState = {
      sessionId,
      currentSlide: "slide_1",
      usedSlides: /* @__PURE__ */ new Set(["slide_1"]),
      phase: "waiting",
      votes: { logical: 0, chaotic: 0 },
      voters: /* @__PURE__ */ new Set(),
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
      headers: { "Content-Type": "application/json" }
    });
  }
  // RPC method: Start the game
  async startGame(deckId, maxSlides = 10) {
    await this.ensureGameStateLoaded();
    if (!this.gameState) {
      return new Response(JSON.stringify({
        success: false,
        error: "Session not initialized"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    this.gameState.phase = "presenting";
    this.gameState.maxSlides = maxSlides;
    this.gameState.timerEnd = Date.now() + 45e3;
    await this.saveGameState();
    this.startPresentationTimer();
    this.broadcastGameState();
    return new Response(JSON.stringify({
      success: true,
      gameState: this.getPublicGameState()
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  // RPC method: Submit a vote
  async vote(userId, choice) {
    await this.ensureGameStateLoaded();
    if (!this.gameState || !this.gameState.votingOpen) {
      return new Response(JSON.stringify({
        success: false,
        error: "Voting is not currently open"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (this.gameState.voters.has(userId)) {
      return new Response(JSON.stringify({
        success: false,
        error: "User has already voted"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    this.gameState.votes[choice]++;
    this.gameState.voters.add(userId);
    this.broadcastVoteUpdate();
    return new Response(JSON.stringify({
      success: true,
      currentVotes: this.gameState.votes
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  // RPC method: Get current game status
  async getStatus() {
    await this.ensureGameStateLoaded();
    if (!this.gameState) {
      return new Response(JSON.stringify({
        error: "Session not found"
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    const response = {
      sessionId: this.gameState.sessionId,
      currentSlide: this.gameState.currentSlide,
      phase: this.gameState.phase,
      votes: this.gameState.votes,
      timeRemaining: Math.max(0, this.gameState.timerEnd - Date.now()),
      slideCount: this.gameState.slideCount,
      votingOpen: this.gameState.votingOpen
    };
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" }
    });
  }
  // Handle WebSocket connections with Hibernation API
  async handleWebSocket(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    this.ctx.acceptWebSocket(server);
    const metadata = {
      joinedAt: Date.now(),
      lastActivity: Date.now()
    };
    server.serializeAttachment(metadata);
    const pingRequest = new Request("ws://ping");
    const pongResponse = new Response("pong");
    this.ctx.setWebSocketAutoResponse(pingRequest, pongResponse);
    await this.ensureGameStateLoaded();
    if (this.gameState) {
      this.sendToSocket(server, {
        type: "gameState",
        data: this.getPublicGameState(),
        timestamp: Date.now()
      });
    }
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  // WebSocket message handler (called when DO wakes from hibernation)
  async webSocketMessage(ws, message) {
    try {
      await this.ensureGameStateLoaded();
      const data = JSON.parse(message);
      const metadata = ws.deserializeAttachment();
      metadata.lastActivity = Date.now();
      ws.serializeAttachment(metadata);
      switch (data.type) {
        case "ping":
          this.sendToSocket(ws, {
            type: "pong",
            data: { timestamp: Date.now() },
            timestamp: Date.now()
          });
          break;
        case "join":
          if (data.userId) {
            metadata.userId = data.userId;
            ws.serializeAttachment(metadata);
          }
          break;
        default:
          console.log("Unknown WebSocket message type:", data.type);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
      this.sendToSocket(ws, {
        type: "error",
        data: { message: "Failed to process message" },
        timestamp: Date.now()
      });
    }
  }
  // WebSocket close handler
  async webSocketClose(ws, code, reason, wasClean) {
  }
  // Alarm handler for game timers
  async alarm() {
    await this.ensureGameStateLoaded();
    if (!this.gameState) return;
    if (this.gameState.phase === "presenting") {
      this.gameState.phase = "voting";
      this.startVotingTimer();
    } else if (this.gameState.phase === "voting") {
      await this.processVotesAndAdvance();
    }
  }
  // Ensure game state is loaded from SQLite (important after hibernation)
  async ensureGameStateLoaded() {
    if (!this.gameState) {
      await this.loadGameState();
    }
  }
  async saveGameState() {
    if (!this.gameState) return;
    this.sql.exec(
      `
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
  async loadGameState() {
    const result = this.sql.exec(
      "SELECT * FROM game_session ORDER BY updated_at DESC LIMIT 1"
    ).one();
    if (result) {
      this.gameState = {
        sessionId: result.session_id,
        currentSlide: result.current_slide,
        usedSlides: new Set(JSON.parse(result.used_slides)),
        phase: result.phase,
        votes: { logical: 0, chaotic: 0 },
        voters: /* @__PURE__ */ new Set(),
        votingOpen: false,
        timerEnd: 0,
        slideCount: result.slide_count,
        maxSlides: result.max_slides
      };
    }
  }
  startPresentationTimer() {
    this.ctx.storage.setAlarm(Date.now() + 45e3);
  }
  startVotingTimer() {
    this.gameState.votingOpen = true;
    this.gameState.voters.clear();
    this.gameState.votes = { logical: 0, chaotic: 0 };
    this.ctx.storage.setAlarm(Date.now() + 1e4);
    this.broadcastGameState();
  }
  async processVotesAndAdvance() {
    if (!this.gameState) return;
    this.gameState.votingOpen = false;
    const winner = this.gameState.votes.logical > this.gameState.votes.chaotic ? "logical" : "chaotic";
    const nextSlide = this.getNextSlide(winner);
    if (!nextSlide || this.gameState.slideCount >= this.gameState.maxSlides) {
      this.gameState.phase = "finished";
      this.broadcastGameState();
      await this.saveGameState();
      return;
    }
    this.gameState.currentSlide = nextSlide;
    this.gameState.usedSlides.add(nextSlide);
    this.gameState.slideCount++;
    this.gameState.phase = "presenting";
    this.gameState.timerEnd = Date.now() + 45e3;
    await this.saveGameState();
    this.startPresentationTimer();
    this.broadcastSlideChange(nextSlide);
  }
  getNextSlide(choice) {
    if (!this.gameState) return null;
    const adjacency = this.sql.exec(
      "SELECT * FROM adjacency WHERE slide_id = ?",
      this.gameState.currentSlide
    ).one();
    if (!adjacency) return null;
    const options = choice === "logical" ? JSON.parse(adjacency.logical_slides) : JSON.parse(adjacency.chaotic_slides);
    for (const slideId of options) {
      if (!this.gameState.usedSlides.has(slideId)) {
        return slideId;
      }
    }
    return null;
  }
  getPublicGameState() {
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
  broadcastGameState() {
    this.broadcast({
      type: "gameState",
      data: this.getPublicGameState(),
      timestamp: Date.now()
    });
  }
  broadcastVoteUpdate() {
    this.broadcast({
      type: "voteUpdate",
      data: { votes: this.gameState?.votes },
      timestamp: Date.now()
    });
  }
  broadcastSlideChange(slideId) {
    this.broadcast({
      type: "slideChange",
      data: { slideId },
      timestamp: Date.now()
    });
  }
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    this.ctx.getWebSockets().forEach((ws) => {
      try {
        ws.send(messageStr);
      } catch (error) {
        console.error("Error broadcasting to socket:", error);
      }
    });
  }
  sendToSocket(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      console.error("Error sending to socket:", error);
    }
  }
};

// src/index.ts
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders()
      });
    }
    try {
      if (pathname === "/" || pathname === "/vote") {
        return serveStaticFile("vote.html");
      }
      if (pathname === "/display") {
        return serveStaticFile("display.html");
      }
      if (pathname === "/admin") {
        return serveStaticFile("admin.html");
      }
      const slideMatch = pathname.match(/^\/slides\/(.+)$/);
      if (slideMatch) {
        return await serveSlideImage(slideMatch[1], env.SLIDES);
      }
      const sessionMatch = pathname.match(/^\/session\/([^\/]+)\/(.+)$/);
      if (sessionMatch) {
        const [, sessionId, action] = sessionMatch;
        return await handleSessionRequest(sessionId, action, request, env);
      }
      if (pathname === "/create-session" && request.method === "POST") {
        return await createGameSession(request, env);
      }
      return new Response("Not Found", {
        status: 404,
        headers: getCorsHeaders()
      });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal Server Error", {
        status: 500,
        headers: getCorsHeaders()
      });
    }
  }
};
async function handleSessionRequest(sessionId, action, request, env) {
  const id = env.GAME_SESSION.idFromName(sessionId);
  const stub = env.GAME_SESSION.get(id);
  switch (action) {
    case "vote":
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: getCorsHeaders()
        });
      }
      const voteData = await request.json();
      return await stub.vote(voteData.userId, voteData.choice);
    case "status":
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: getCorsHeaders()
        });
      }
      return await stub.getStatus();
    case "ws":
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", {
          status: 426,
          headers: getCorsHeaders()
        });
      }
      return await stub.handleWebSocket(request);
    case "start":
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: getCorsHeaders()
        });
      }
      const startData = await request.json();
      return await stub.startGame(startData.deckId, startData.maxSlides);
    default:
      return new Response("Unknown action", {
        status: 404,
        headers: getCorsHeaders()
      });
  }
}
__name(handleSessionRequest, "handleSessionRequest");
async function createGameSession(request, env) {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const id = env.GAME_SESSION.idFromName(roomCode);
  const stub = env.GAME_SESSION.get(id);
  await stub.initialize();
  return new Response(JSON.stringify({
    sessionId: roomCode,
    success: true
  }), {
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders()
    }
  });
}
__name(createGameSession, "createGameSession");
async function serveSlideImage(filename, slidesBucket) {
  try {
    const object = await slidesBucket.get(filename);
    if (!object) {
      return new Response("Image not found", {
        status: 404,
        headers: getCorsHeaders()
      });
    }
    const headers = {
      "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      // Cache for 24 hours
      ...getCorsHeaders()
    };
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("Error serving slide image:", error);
    return new Response("Error loading image", {
      status: 500,
      headers: getCorsHeaders()
    });
  }
}
__name(serveSlideImage, "serveSlideImage");
function serveStaticFile(filename) {
  const html = generatePlaceholderHTML(filename);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html",
      ...getCorsHeaders()
    }
  });
}
__name(serveStaticFile, "serveStaticFile");
function generatePlaceholderHTML(filename) {
  const title = filename.replace(".html", "").toUpperCase();
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Battle Decks - ${title}</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: #f5f5f5;
            }
            .container {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 2px 20px rgba(0,0,0,0.1);
                text-align: center;
            }
            .status {
                background: #e8f5e8;
                padding: 15px;
                border-radius: 8px;
                margin: 20px 0;
                color: #2d5a2d;
            }
            button {
                background: #0066cc;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                margin: 5px;
            }
            button:hover {
                background: #0052a3;
            }
            input {
                padding: 12px;
                border: 2px solid #ddd;
                border-radius: 8px;
                font-size: 16px;
                margin: 5px;
                width: 200px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>\u{1F3AE} Battle Decks - ${title}</h1>
            <div class="status">
                \u2705 SQLite-backed Durable Objects deployed successfully!<br>
                \u2705 WebSocket Hibernation API ready!<br>
                \u2705 2025 configuration active!
            </div>

            ${getPageContent(filename)}
        </div>

        <script>
            // Basic functionality for testing
            ${getPageScript(filename)}
        <\/script>
    </body>
    </html>
  `;
}
__name(generatePlaceholderHTML, "generatePlaceholderHTML");
function getPageContent(filename) {
  switch (filename) {
    case "vote.html":
      return `
        <h2>\u{1F5F3}\uFE0F Audience Voting</h2>
        <p>Join a game session by entering the room code:</p>
        <input type="text" id="roomCode" placeholder="Enter room code" maxlength="6">
        <button onclick="joinSession()">Join Session</button>

        <div id="votingPanel" style="display: none; margin-top: 30px;">
          <h3>Vote for the next slide:</h3>
          <button id="logicalBtn" onclick="vote('logical')" style="background: #28a745; margin: 10px;">
            \u{1F4CA} Logical
          </button>
          <button id="chaoticBtn" onclick="vote('chaotic')" style="background: #dc3545; margin: 10px;">
            \u{1F3B2} Chaotic
          </button>
          <div id="voteStatus"></div>
        </div>
      `;
    case "display.html":
      return `
        <h2>\u{1F4FA} Main Display</h2>
        <p>This is where the presentation slides and vote counts will be displayed.</p>
        <div id="slideContainer" style="border: 2px dashed #ccc; padding: 40px; margin: 20px 0;">
          <p>Slide display area</p>
          <div id="currentSlide">No slide loaded</div>
        </div>
        <div id="voteDisplay">
          <p>Vote counts will appear here</p>
        </div>
      `;
    case "admin.html":
      return `
        <h2>\u2699\uFE0F Presenter Controls</h2>
        <button onclick="createSession()">Create New Session</button>
        <button onclick="startGame()">Start Game</button>
        <div id="sessionInfo" style="margin: 20px 0;"></div>
        <div id="gameStatus"></div>
      `;
    default:
      return `<p>Page placeholder for ${filename}</p>`;
  }
}
__name(getPageContent, "getPageContent");
function getPageScript(filename) {
  switch (filename) {
    case "vote.html":
      return `
        let currentSession = null;
        let userId = 'user_' + Math.random().toString(36).substr(2, 9);

        function joinSession() {
          const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
          if (!roomCode) return;

          currentSession = roomCode;
          document.getElementById('votingPanel').style.display = 'block';
          console.log('Joined session:', roomCode);
        }

        async function vote(choice) {
          if (!currentSession) return;

          try {
            const response = await fetch(\`/session/\${currentSession}/vote\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, choice })
            });

            const result = await response.json();
            document.getElementById('voteStatus').innerHTML =
              result.success ? \`\u2705 Vote cast for \${choice}!\` : \`\u274C \${result.error}\`;
          } catch (error) {
            console.error('Vote error:', error);
          }
        }
      `;
    case "admin.html":
      return `
        let currentSession = null;

        async function createSession() {
          try {
            const response = await fetch('/create-session', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
              currentSession = result.sessionId;
              document.getElementById('sessionInfo').innerHTML =
                \`\u2705 Session created: <strong>\${result.sessionId}</strong>\`;
            }
          } catch (error) {
            console.error('Create session error:', error);
          }
        }

        async function startGame() {
          if (!currentSession) {
            alert('Create a session first!');
            return;
          }

          try {
            const response = await fetch(\`/session/\${currentSession}/start\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deckId: 'mock-deck', maxSlides: 5 })
            });

            const result = await response.json();
            document.getElementById('gameStatus').innerHTML =
              result.success ? '\u2705 Game started!' : \`\u274C \${result.error}\`;
          } catch (error) {
            console.error('Start game error:', error);
          }
        }
      `;
    default:
      return "// No script for this page";
  }
}
__name(getPageScript, "getPageScript");
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(getCorsHeaders, "getCorsHeaders");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Y0fWjc/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Y0fWjc/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  GameSession,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
