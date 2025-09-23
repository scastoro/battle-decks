import { Env, VoteRequest, StartGameRequest } from './types/index';
import { GameSession } from './game-session';

// Export the Durable Object class for Cloudflare
export { GameSession };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(),
      });
    }

    try {
      // Route static files
      if (pathname === '/' || pathname === '/vote') {
        return serveStaticFile('vote.html');
      }

      if (pathname === '/display') {
        return serveStaticFile('display.html');
      }

      if (pathname === '/admin') {
        return serveStaticFile('admin.html');
      }

      // Handle slide images from R2
      const slideMatch = pathname.match(/^\/slides\/(.+)$/);
      if (slideMatch) {
        return await serveSlideImage(slideMatch[1], env.SLIDES);
      }

      // Handle API routes - all require a session ID
      const sessionMatch = pathname.match(/^\/session\/([^\/]+)\/(.+)$/);
      if (sessionMatch) {
        const [, sessionId, action] = sessionMatch;
        return await handleSessionRequest(sessionId, action, request, env);
      }

      // Handle session creation
      if (pathname === '/create-session' && request.method === 'POST') {
        return await createGameSession(request, env);
      }

      return new Response('Not Found', {
        status: 404,
        headers: getCorsHeaders()
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal Server Error', {
        status: 500,
        headers: getCorsHeaders()
      });
    }
  },
};

async function handleSessionRequest(
  sessionId: string,
  action: string,
  request: Request,
  env: Env
): Promise<Response> {
  // Get the Durable Object instance using the session ID as the name
  const id = env.GAME_SESSION.idFromName(sessionId);
  const stub = env.GAME_SESSION.get(id) as DurableObjectStub<GameSession>;

  switch (action) {
    case 'vote':
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: getCorsHeaders()
        });
      }
      const voteData: VoteRequest = await request.json();
      return await stub.vote(voteData.userId, voteData.choice);

    case 'status':
      if (request.method !== 'GET') {
        return new Response('Method not allowed', {
          status: 405,
          headers: getCorsHeaders()
        });
      }
      return await stub.getStatus();

    case 'ws':
      // WebSocket upgrade - handle in Worker, not via RPC
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected Upgrade: websocket', {
          status: 426,
          headers: getCorsHeaders()
        });
      }

      // Create WebSocket pair in Worker
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      // Pass server socket to Durable Object via fetch (not RPC)
      await stub.fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept-websocket' }),
        webSocket: server
      });

      // Return client socket directly from Worker
      return new Response(null, {
        status: 101,
        webSocket: client
      } as ResponseInit & { webSocket: WebSocket });

    case 'start':
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: getCorsHeaders()
        });
      }
      const startData: StartGameRequest = await request.json();
      return await stub.startGame(startData.deckId, startData.maxSlides);

    default:
      return new Response('Unknown action', {
        status: 404,
        headers: getCorsHeaders()
      });
  }
}

async function createGameSession(request: Request, env: Env): Promise<Response> {
  // Generate a random 6-character room code
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  // Get the Durable Object instance using the room code as the name
  const id = env.GAME_SESSION.idFromName(roomCode);
  const stub = env.GAME_SESSION.get(id) as DurableObjectStub<GameSession>;

  // Initialize the session with room code
  await stub.initialize(roomCode);

  return new Response(JSON.stringify({
    sessionId: roomCode,
    success: true
  }), {
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders()
    }
  });
}

async function serveSlideImage(filename: string, slidesBucket: R2Bucket): Promise<Response> {
  try {
    const object = await slidesBucket.get(filename);

    if (!object) {
      return new Response('Image not found', {
        status: 404,
        headers: getCorsHeaders()
      });
    }

    const headers = {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      ...getCorsHeaders()
    };

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Error serving slide image:', error);
    return new Response('Error loading image', {
      status: 500,
      headers: getCorsHeaders()
    });
  }
}

function serveStaticFile(filename: string): Response {
  // For now, return a simple HTML placeholder
  // In production, you'd serve actual files from public/
  const html = generatePlaceholderHTML(filename);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      ...getCorsHeaders()
    }
  });
}

function generatePlaceholderHTML(filename: string): string {
  const title = filename.replace('.html', '').toUpperCase();

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
            <h1>🎮 Battle Decks - ${title}</h1>
            <div class="status">
                ✅ SQLite-backed Durable Objects deployed successfully!<br>
                ✅ WebSocket Hibernation API ready!<br>
                ✅ 2025 configuration active!
            </div>

            ${getPageContent(filename)}
        </div>

        <script>
            // Basic functionality for testing
            ${getPageScript(filename)}
        </script>
    </body>
    </html>
  `;
}

function getPageContent(filename: string): string {
  switch (filename) {
    case 'vote.html':
      return `
        <h2>🗳️ Audience Voting</h2>
        <p>Join a game session by entering the room code:</p>
        <input type="text" id="roomCode" placeholder="Enter room code" maxlength="6">
        <button onclick="joinSession()">Join Session</button>

        <div id="votingPanel" style="display: none; margin-top: 30px;">
          <h3>Vote for the next slide:</h3>
          <button id="logicalBtn" onclick="vote('logical')" style="background: #28a745; margin: 10px;">
            📊 Logical
          </button>
          <button id="chaoticBtn" onclick="vote('chaotic')" style="background: #dc3545; margin: 10px;">
            🎲 Chaotic
          </button>
          <div id="voteStatus"></div>
        </div>
      `;

    case 'display.html':
      return `
        <h2>📺 Main Display</h2>
        <p>This is where the presentation slides and vote counts will be displayed.</p>
        <div id="slideContainer" style="border: 2px dashed #ccc; padding: 40px; margin: 20px 0;">
          <p>Slide display area</p>
          <div id="currentSlide">No slide loaded</div>
        </div>
        <div id="voteDisplay">
          <p>Vote counts will appear here</p>
        </div>
      `;

    case 'admin.html':
      return `
        <h2>⚙️ Presenter Controls</h2>
        <button onclick="createSession()">Create New Session</button>
        <button onclick="startGame()">Start Game</button>
        <div id="sessionInfo" style="margin: 20px 0;"></div>
        <div id="gameStatus"></div>
      `;

    default:
      return `<p>Page placeholder for ${filename}</p>`;
  }
}

function getPageScript(filename: string): string {
  switch (filename) {
    case 'vote.html':
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
              result.success ? \`✅ Vote cast for \${choice}!\` : \`❌ \${result.error}\`;
          } catch (error) {
            console.error('Vote error:', error);
          }
        }
      `;

    case 'admin.html':
      return `
        let currentSession = null;

        async function createSession() {
          try {
            const response = await fetch('/create-session', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
              currentSession = result.sessionId;
              document.getElementById('sessionInfo').innerHTML =
                \`✅ Session created: <strong>\${result.sessionId}</strong>\`;
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
              result.success ? '✅ Game started!' : \`❌ \${result.error}\`;
          } catch (error) {
            console.error('Start game error:', error);
          }
        }
      `;

    default:
      return '// No script for this page';
  }
}

function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}