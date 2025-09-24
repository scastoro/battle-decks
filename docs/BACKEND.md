# Battle Decks - Backend Documentation

## Overview

The Battle Decks backend is built on Cloudflare Workers using TypeScript, with Durable Objects providing stateful session management and SQLite for persistent storage.

## Core Components

### 1. Worker Entry Point (src/index.ts)

The main Worker serves as the request router and handles all incoming HTTP requests.

#### Key Functions:

**`fetch(request, env, ctx)`** - Main request handler
- Routes static assets (`/`, `/vote`, `/display`, `/admin`)
- Serves slide images from R2 storage (`/slides/*`)
- Handles API routes for game sessions (`/session/{sessionId}/*`)
- Manages session creation (`/create-session`)

**`handleSessionRequest(sessionId, action, request, env)`** - API router
- **`/vote`**: Submit votes during voting phase
- **`/status`**: Get current game state
- **`/ws`**: WebSocket upgrade for real-time updates
- **`/start`**: Start a game session

**`createGameSession(request, env)`** - Session factory
- Generates 6-character uppercase room codes
- Creates Durable Object instance with room code as name
- Returns session ID for client use

**`serveSlideImage(filename, slidesBucket)`** - R2 asset serving
- Retrieves slide images from R2 bucket
- Sets appropriate content types and cache headers
- 24-hour cache control for performance

### 2. Game Session Durable Object (src/game-session.ts)

Each game session runs as an isolated Durable Object instance with SQLite persistence.

#### SQLite Schema:

```sql
-- Slide relationship data (pre-computed)
CREATE TABLE adjacency (
  slide_id TEXT PRIMARY KEY,
  logical_slides TEXT NOT NULL,  -- JSON array
  chaotic_slides TEXT NOT NULL   -- JSON array
);

-- Game session state (persistent across hibernation)
CREATE TABLE game_session (
  session_id TEXT PRIMARY KEY,
  current_slide TEXT NOT NULL,
  used_slides TEXT NOT NULL,     -- JSON array
  phase TEXT NOT NULL,           -- 'waiting'|'presenting'|'voting'|'finished'
  slide_count INTEGER NOT NULL,
  max_slides INTEGER NOT NULL,
  timer_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Durable Object metadata (room code recovery)
CREATE TABLE do_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

#### Key Methods:

**`initialize(roomCode)`** - Session setup
- Creates initial game state
- Stores room code for hibernation recovery
- Sets default configuration (10 slides, slide_1 start)

**`startGame(deckId, maxSlides)`** - Game initiation
- Transitions from 'waiting' to 'presenting' phase
- Sets 45-second presentation timer
- Broadcasts state change to all connected clients

**`vote(userId, choice)`** - Vote processing
- Validates voting is open and user hasn't voted
- Records vote ('logical' or 'chaotic')
- Broadcasts live vote counts to all clients
- Prevents double voting with user tracking

**`fetch(request)`** - WebSocket handling
- Handles WebSocket upgrade requests
- Accepts connections using hibernation API
- Attaches metadata for connection persistence
- Sends initial game state to new connections

**`alarm()`** - Timer management
- Handles presentation→voting and voting→next slide transitions
- Processes vote results and advances slides
- Manages final slide detection and game completion
- Recovers room code after Durable Object restarts

#### WebSocket Management:

**Hibernation Support**:
- Connections survive Durable Object restarts
- Metadata serialized to WebSocket attachment
- Automatic recovery on DO wake-up

**Message Types**:
- `gameState`: Complete game state updates
- `voteUpdate`: Live vote count changes
- `slideChange`: Slide transition notifications
- `ping/pong`: Connection health checks

#### Game Flow Logic:

1. **Waiting Phase**: Initial state, waiting for game start
2. **Presenting Phase**: 45-second timer for presenter
3. **Voting Phase**: 10-second timer for audience voting
4. **Slide Transition**: Process votes, advance slide, repeat
5. **Finished Phase**: Game complete when max slides reached

### 3. Type System (src/types/index.ts)

Comprehensive TypeScript types ensure type safety across the application.

#### Core Types:

**`GamePhase`** - Game state enumeration
```typescript
type GamePhase = 'waiting' | 'presenting' | 'voting' | 'finished';
```

**`GameState`** - In-memory game state
```typescript
interface GameState {
  sessionId: string;
  currentSlide: string;
  usedSlides: Set<string>;
  phase: GamePhase;
  votes: { logical: number; chaotic: number; };
  voters: Set<string>;
  votingOpen: boolean;
  timerEnd: number;
  slideCount: number;
  maxSlides: number;
}
```

**`Env`** - Cloudflare bindings interface
```typescript
interface Env {
  GAME_SESSION: DurableObjectNamespace;
  SLIDES: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
}
```

## Data Persistence Strategy

### SQLite Storage
- **ACID Transactions**: Ensure data consistency
- **Hibernation Survival**: State persists across DO restarts
- **Performance**: Optimized with `PRAGMA optimize`
- **Recovery**: Room code metadata enables alarm handler recovery

### State Management
- **Hybrid Approach**: SQLite for persistence, memory for performance
- **Lazy Loading**: Game state loaded on-demand after hibernation
- **Consistent Updates**: All state changes immediately persisted
- **Migration Support**: Schema versioning with new_sqlite_classes

## Error Handling

### Graceful Degradation
- WebSocket failures don't break HTTP API
- Missing slides default to placeholder content
- Invalid votes return structured error responses
- Connection timeouts handled with exponential backoff

### Alarm Reliability
- Room code recovery prevents alarm handler failures
- State validation before processing timers
- Fallback to DO ID if room code unavailable
- Comprehensive error logging for debugging

## Performance Characteristics

### Latency Targets
- **Vote Registration**: <100ms end-to-end
- **WebSocket Broadcasting**: <50ms to all clients
- **State Persistence**: <10ms SQLite operations
- **Session Creation**: <200ms including DO instantiation

### Scalability
- **Per-Session**: 100+ concurrent users supported
- **Global**: Unlimited sessions (one DO per session)
- **Storage**: SQLite handles typical game size efficiently
- **Memory**: Minimal footprint with hibernation

## Security Model

### Session Isolation
- Each game runs in isolated Durable Object
- Room codes provide session access control
- No cross-session data leakage possible
- User IDs generated client-side for simplicity

### Input Validation
- TypeScript provides compile-time type safety
- Runtime validation for all API inputs
- SQL injection prevented by parameterized queries
- WebSocket message structure validation

## Development Tools

### Local Development
- `wrangler dev`: Local development with hot reload
- `wrangler tail`: Real-time log streaming
- SQLite inspection with DO console access
- WebSocket debugging with browser dev tools

### Debugging Features
- Comprehensive console logging
- WebSocket connection tracking
- Game state inspection endpoints
- Timer and alarm status monitoring