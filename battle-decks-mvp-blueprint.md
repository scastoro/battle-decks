# Battle Decks MVP - Technical Blueprint

## Project Overview

Battle Decks is a live presentation game where presenters improvise with random slides while the audience votes to control slide progression. The audience chooses between "logical" (related) or "chaotic" (unrelated) next slides via their phones while watching the presentation on a main screen.

**Core Loop:**
1. Presenter speaks about current slide (45 seconds)
2. Audience votes on phones: Logical vs Chaotic (10 seconds)  
3. Next slide appears instantly based on vote winner
4. Repeat for ~10 slides

## Technical Stack

- **Backend**: Cloudflare Workers + Durable Objects
- **Storage**: Cloudflare KV (metadata) + R2 (images)
- **Frontend**: Static HTML/JS
- **AI**: Cloudflare Workers AI for embeddings

## Architecture Components

### 1. Setup Phase (Run Once Per Deck)

```
Upload slides → Generate embeddings → Calculate similarities → Store adjacency lists
```

**Purpose**: Pre-compute all slide relationships to avoid real-time AI during shows

**Data Structure**:
```javascript
// Stored in KV
{
  "slide_1": {
    logical: ["slide_5", "slide_8", "slide_12"],  // Most similar slides
    chaotic: ["slide_34", "slide_39", "slide_41"] // Least similar slides
  }
}
```

### 2. Runtime Components

#### Cloudflare Worker (Request Router)
- Routes HTTP requests to appropriate Durable Object
- Serves static HTML for voting interface
- Handles slide image serving from R2

#### Durable Object (Game Session)
- Manages game state (current slide, used slides)
- Counts votes with strong consistency
- Prevents double voting
- WebSocket connection for main screen updates
- Tracks 45-second presentation timer

#### Storage Layout
- **KV**: Pre-computed adjacency lists, slide metadata
- **R2**: Slide images (JPEG/PNG)
- **DO Memory**: Active game state, vote counts

## API Endpoints

### Worker Routes

```
GET  /                      → Voting interface HTML
GET  /join/{roomCode}       → Join specific room
GET  /slides/{slideId}.jpg  → Serve slide image from R2
GET  /admin                 → Presenter control panel

POST /session/{sessionId}/vote   → Submit vote
GET  /session/{sessionId}/status → Get current game state
WS   /session/{sessionId}/ws     → WebSocket for main screen
```

### Durable Object Internal Routes

```
POST /start-game     → Initialize game with deck ID
POST /vote           → Record audience vote
GET  /status         → Current votes and game state
POST /open-voting    → Start 10-second voting window
WS   /ws            → WebSocket for real-time updates
```

## Data Flow

### Game Initialization
1. Host creates session → generates room code
2. DO loads pre-computed adjacency lists from KV
3. DO initializes game state (slide #1, empty used set)

### Voting Cycle
1. DO starts 45-second presentation timer
2. At 0 seconds, DO opens voting window
3. Audience POST votes to Worker → forwarded to DO
4. DO counts votes atomically, prevents double voting
5. After 10 seconds, DO determines winner
6. DO updates current slide, adds to used set
7. Main screen receives update via WebSocket
8. Cycle repeats

### Next Slide Selection
```javascript
// DO selects from pre-computed options
const options = adjacencyList[currentSlide];
const logical = options.logical.find(id => !usedSlides.has(id));
const chaotic = options.chaotic.find(id => !usedSlides.has(id));
```

## Implementation Steps

### Phase 1: Core Infrastructure (Day 1-2)
1. Create Cloudflare Worker project
2. Implement basic Durable Object
3. Set up KV namespace and R2 bucket
4. Create simple vote counting logic
5. Test with hardcoded slide IDs

### Phase 2: Slide Processing (Day 3-4)
1. Build slide upload endpoint
2. Integrate Workers AI for embeddings
3. Calculate similarity matrix
4. Generate and store adjacency lists
5. Store images in R2

### Phase 3: Game Logic (Day 5-6)
1. Implement game state management in DO
2. Add used slides tracking
3. Build timer system (45s + 10s cycles)
4. Handle edge cases (no options available)

### Phase 4: Frontend (Day 7-8)
1. Create voting interface (2 buttons + room code)
2. Build presenter control panel
3. Implement main screen display
4. Add WebSocket for live updates

### Phase 5: Testing & Polish (Day 9-10)
1. End-to-end testing
2. Add error handling
3. Improve UI/UX
4. Deploy to production

## File Structure

```
/battle-decks-mvp
├── /src
│   ├── index.js           # Main Worker
│   ├── durable-object.js  # Game session DO
│   ├── ai-processor.js    # Embedding generation
│   └── /frontend
│       ├── vote.html      # Audience interface
│       ├── admin.html     # Presenter controls
│       └── display.html   # Main screen
├── /scripts
│   └── process-slides.js  # Batch processing script
└── wrangler.toml          # Cloudflare config
```

## Configuration (wrangler.toml)

```toml
name = "battle-decks"
main = "src/index.js"

[[kv_namespaces]]
binding = "DECKS"
id = "your-kv-namespace-id"

[[r2_buckets]]
binding = "SLIDES"
bucket_name = "battle-decks-slides"

[[durable_objects.bindings]]
name = "BATTLE_DECK_SESSION"
class_name = "BattleDeckSession"

[ai]
binding = "AI"
```

## MVP Simplifications

**What we're NOT building:**
- User accounts/authentication
- Multiple game modes
- Difficulty settings
- Score tracking
- Game history
- Mobile app (just web)
- Custom slide uploads per game
- Preview images during voting

**Fixed constraints:**
- 45-second presentation timer
- 10-second voting window
- 50 slides per deck
- ~10 slides per game
- 2 voting options only

## Key Code Components

### Durable Object Structure
```javascript
export class BattleDeckSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    
    // Game state
    this.adjacencyList = null;
    this.currentSlide = "slide_1";
    this.usedSlides = new Set();
    
    // Voting state
    this.votes = { logical: 0, chaotic: 0 };
    this.voters = new Set();
    this.votingOpen = false;
    
    // WebSocket for main screen
    this.mainScreenWS = null;
  }
}
```

### Vote Prevention
```javascript
async handleVote(userId, choice) {
  if (!this.votingOpen) {
    return { error: "Voting closed" };
  }
  if (this.voters.has(userId)) {
    return { error: "Already voted" };
  }
  
  this.votes[choice]++;
  this.voters.add(userId);
  
  // Update main screen
  if (this.mainScreenWS) {
    this.mainScreenWS.send(JSON.stringify({ votes: this.votes }));
  }
  
  return { success: true };
}
```

### Slide Selection
```javascript
getNextOptions() {
  const options = this.adjacencyList[this.currentSlide];
  
  // Find unused slides
  const logical = options.logical.find(id => !this.usedSlides.has(id));
  const chaotic = options.chaotic.find(id => !this.usedSlides.has(id));
  
  // Fallback to random if needed
  if (!logical || !chaotic) {
    return this.getRandomUnusedSlides();
  }
  
  return { logical, chaotic };
}
```

## Testing Checklist

- [ ] Can upload and process 50 slides
- [ ] Adjacency lists generated correctly
- [ ] Room codes work
- [ ] Voting prevents double-votes
- [ ] Timers auto-advance game
- [ ] Used slides don't repeat
- [ ] WebSocket updates main screen
- [ ] Game completes after ~10 slides
- [ ] Handles 50+ concurrent voters
- [ ] Images load quickly from R2

## Success Metrics

- Setup to gameplay: < 5 minutes
- Vote registration: < 100ms
- Slide transitions: Instant
- Support: 100+ voters per room
- Game duration: ~10 minutes
- Zero slides repeated per game

## Deployment Commands

```bash
# Install dependencies
npm install wrangler

# Create KV namespace
wrangler kv:namespace create DECKS

# Create R2 bucket
wrangler r2 bucket create battle-decks-slides

# Deploy
wrangler publish

# Tail logs
wrangler tail
```

## Next Steps After MVP

Once core game works:
1. Add presenter hints/assists
2. Implement difficulty levels
3. Create themed slide decks
4. Add audience reactions
5. Build analytics dashboard
6. Support multiple rooms
7. Add sound effects/music
8. Create tournament mode