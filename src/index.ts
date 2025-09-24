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
      // Route static files from ASSETS
      if (pathname === '/' || pathname === '/vote') {
        return await serveStaticAsset('/vote.html', env.ASSETS);
      }

      if (pathname === '/display') {
        return await serveStaticAsset('/display.html', env.ASSETS);
      }

      if (pathname === '/admin') {
        return await serveStaticAsset('/admin.html', env.ASSETS);
      }

      // Serve other static assets (CSS, JS, etc.)
      if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
        return await serveStaticAsset(pathname, env.ASSETS);
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
      // WebSocket upgrade - use fetch() to avoid RPC serialization issues
      return await stub.fetch(request);

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

async function serveStaticAsset(pathname: string, assets: Fetcher): Promise<Response> {
  try {
    // Fetch the static asset from the ASSETS binding
    const response = await assets.fetch(new Request(`https://placeholder.com${pathname}`));

    if (response.ok) {
      // Create a new response with CORS headers
      const newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          ...getCorsHeaders()
        }
      });

      return newResponse;
    } else {
      // Asset not found, return 404
      return new Response('Asset not found', {
        status: 404,
        headers: getCorsHeaders()
      });
    }

  } catch (error) {
    console.error('Error serving static asset:', error);
    return new Response('Error loading asset', {
      status: 500,
      headers: getCorsHeaders()
    });
  }
}

function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}