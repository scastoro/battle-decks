import {
  Env,
  VoteRequest,
  StartGameRequest,
  CreateDeckRequest,
  CreateDeckResponse,
  DeckMetadata,
  ProcessDeckRequest,
  ProcessDeckResponse,
  ProcessingStatus,
} from './types/index';
import { GameSession } from './game-session';
import { processDeck } from './ai-processor';

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

      // Handle deck management API routes
      if (pathname.startsWith('/api/decks')) {
        return await handleDeckAPI(pathname, request, env, ctx);
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

async function handleDeckAPI(
  pathname: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const corsHeaders = getCorsHeaders();

  // POST /api/decks/create - Create new deck
  if (pathname === '/api/decks/create' && request.method === 'POST') {
    try {
      const body: CreateDeckRequest = await request.json();
      const deckId = generateDeckId();
      const metadata: DeckMetadata = {
        deckId,
        name: body.name,
        description: body.description,
        slideCount: 0,
        status: 'pending',
        createdAt: Date.now(),
      };

      await env.DECKS.put(`deck:${deckId}:metadata`, JSON.stringify(metadata));

      const response: CreateDeckResponse = {
        success: true,
        deckId,
      };

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  // POST /api/decks/:deckId/upload-slide - Upload single slide
  const uploadMatch = pathname.match(/^\/api\/decks\/([^\/]+)\/upload-slide$/);
  if (uploadMatch && request.method === 'POST') {
    const deckId = uploadMatch[1];

    try {
      const formData = await request.formData();
      const slideId = formData.get('slideId') as string;
      const imageFile = formData.get('image') as File;

      if (!slideId || !imageFile) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing slideId or image' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Upload to R2
      const imageBuffer = await imageFile.arrayBuffer();
      const r2Key = `decks/${deckId}/${slideId}`;
      await env.SLIDES.put(r2Key, imageBuffer, {
        httpMetadata: {
          contentType: imageFile.type || 'image/jpeg',
        },
      });

      // Update deck metadata slide count
      const metadataKey = `deck:${deckId}:metadata`;
      const metadataJson = await env.DECKS.get(metadataKey);
      if (metadataJson) {
        const metadata: DeckMetadata = JSON.parse(metadataJson);
        metadata.slideCount++;
        await env.DECKS.put(metadataKey, JSON.stringify(metadata));
      }

      return new Response(
        JSON.stringify({ success: true, slideId }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  // POST /api/decks/:deckId/process - Trigger AI processing
  const processMatch = pathname.match(/^\/api\/decks\/([^\/]+)\/process$/);
  if (processMatch && request.method === 'POST') {
    const deckId = processMatch[1];

    try {
      // Get deck metadata
      const metadataJson = await env.DECKS.get(`deck:${deckId}:metadata`);
      if (!metadataJson) {
        return new Response(
          JSON.stringify({ success: false, error: 'Deck not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      const metadata: DeckMetadata = JSON.parse(metadataJson);

      // Update status to processing
      metadata.status = 'processing';
      await env.DECKS.put(`deck:${deckId}:metadata`, JSON.stringify(metadata));

      // Get list of slide IDs (assuming slides are named slide_1, slide_2, etc.)
      const slideIds: string[] = [];
      for (let i = 1; i <= metadata.slideCount; i++) {
        slideIds.push(`slide_${i}`);
      }

      // Process deck asynchronously
      ctx.waitUntil(
        (async () => {
          const result = await processDeck(deckId, slideIds, env);

          // Update metadata based on result
          const finalMetadata: DeckMetadata = JSON.parse(
            (await env.DECKS.get(`deck:${deckId}:metadata`)) || '{}'
          );
          finalMetadata.status = result.success ? 'ready' : 'failed';
          finalMetadata.processedAt = Date.now();
          if (!result.success) {
            finalMetadata.error = result.error;
          }
          await env.DECKS.put(`deck:${deckId}:metadata`, JSON.stringify(finalMetadata));
        })()
      );

      const status: ProcessingStatus = {
        deckId,
        totalSlides: metadata.slideCount,
        processedSlides: 0,
        status: 'processing',
        currentStep: 'Starting AI processing...',
      };

      const response: ProcessDeckResponse = {
        success: true,
        status,
      };

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  // GET /api/decks/:deckId/status - Get processing status
  const statusMatch = pathname.match(/^\/api\/decks\/([^\/]+)\/status$/);
  if (statusMatch && request.method === 'GET') {
    const deckId = statusMatch[1];

    try {
      const metadataJson = await env.DECKS.get(`deck:${deckId}:metadata`);
      if (!metadataJson) {
        return new Response(
          JSON.stringify({ success: false, error: 'Deck not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      const metadata: DeckMetadata = JSON.parse(metadataJson);

      const status: ProcessingStatus = {
        deckId: metadata.deckId,
        totalSlides: metadata.slideCount,
        processedSlides: metadata.status === 'ready' ? metadata.slideCount : 0,
        status: metadata.status,
        error: metadata.error,
      };

      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  // GET /api/decks - List all decks
  if (pathname === '/api/decks' && request.method === 'GET') {
    try {
      // List all deck metadata keys
      const list = await env.DECKS.list({ prefix: 'deck:', limit: 1000 });
      const decks: DeckMetadata[] = [];

      for (const key of list.keys) {
        if (key.name.endsWith(':metadata')) {
          const metadataJson = await env.DECKS.get(key.name);
          if (metadataJson) {
            decks.push(JSON.parse(metadataJson));
          }
        }
      }

      // Sort by created date (newest first)
      decks.sort((a, b) => b.createdAt - a.createdAt);

      return new Response(JSON.stringify({ decks }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  // DELETE /api/decks/:deckId - Delete deck
  const deleteMatch = pathname.match(/^\/api\/decks\/([^\/]+)$/);
  if (deleteMatch && request.method === 'DELETE') {
    const deckId = deleteMatch[1];

    try {
      // Get deck metadata to know slide count
      const metadataJson = await env.DECKS.get(`deck:${deckId}:metadata`);
      if (!metadataJson) {
        return new Response(
          JSON.stringify({ success: false, error: 'Deck not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      const metadata: DeckMetadata = JSON.parse(metadataJson);

      // Delete from R2
      for (let i = 1; i <= metadata.slideCount; i++) {
        const r2Key = `decks/${deckId}/slide_${i}`;
        await env.SLIDES.delete(r2Key);
      }

      // Delete from KV
      await env.DECKS.delete(`deck:${deckId}:metadata`);
      await env.DECKS.delete(`deck:${deckId}:adjacency`);

      // Delete individual embeddings
      for (let i = 1; i <= metadata.slideCount; i++) {
        await env.DECKS.delete(`deck:${deckId}:embedding:slide_${i}`);
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  return new Response('Not Found', {
    status: 404,
    headers: corsHeaders,
  });
}

function generateDeckId(): string {
  return `deck_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}