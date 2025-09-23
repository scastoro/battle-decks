# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Battle Decks is a live presentation game built on Cloudflare Workers where presenters improvise with random slides while the audience votes to control slide progression. The core architecture uses:

- **Backend**: Cloudflare Workers + Durable Objects for game sessions
- **Storage**: Cloudflare KV (slide metadata/adjacency lists) + R2 (slide images)
- **Frontend**: Static HTML/JS for voting interface and presenter controls
- **AI**: Cloudflare Workers AI for slide embedding generation

## Key Architecture Concepts

### Two-Phase Design
1. **Setup Phase**: Pre-compute slide relationships using AI embeddings to avoid real-time AI during games
2. **Runtime Phase**: Durable Objects manage game state with vote counting and WebSocket updates

### Critical Data Structure
```javascript
// Stored in KV - drives all game logic
{
  "slide_1": {
    logical: ["slide_5", "slide_8", "slide_12"],  // Most similar slides
    chaotic: ["slide_34", "slide_39", "slide_41"] // Least similar slides
  }
}
```

### Game Flow
- 45-second presentation timer → 10-second voting window → instant slide transition
- Durable Object prevents double voting and manages used slides set
- WebSocket updates main screen with vote counts and slide changes

## Development Commands

```bash
# Install Cloudflare CLI
npm install wrangler

# Create required Cloudflare resources
wrangler kv:namespace create DECKS
wrangler r2 bucket create battle-decks-slides

# Deploy to Cloudflare
wrangler publish

# View logs
wrangler tail

# Local development
wrangler dev
```

## File Structure (Planned)

```
/src
├── index.js           # Main Worker (request router)
├── durable-object.js  # BattleDeckSession class (game state)
├── ai-processor.js    # Embedding generation logic
└── /frontend
    ├── vote.html      # Audience voting interface
    ├── admin.html     # Presenter control panel
    └── display.html   # Main screen display

/scripts
└── process-slides.js  # Batch slide processing

wrangler.toml          # Cloudflare configuration
```

## Configuration Requirements

The `wrangler.toml` must include:
- KV namespace binding: `DECKS`
- R2 bucket binding: `SLIDES`
- Durable Object binding: `BATTLE_DECK_SESSION`
- Workers AI binding: `AI`

## Key Constraints

- Fixed 50 slides per deck, ~10 slides per game
- No slide repetition within a game session
- Support for 100+ concurrent voters per room
- Vote registration must be < 100ms
- Slide transitions must be instant

## Critical Implementation Details

- Durable Objects provide strong consistency for vote counting
- Used slides tracking prevents repetition via Set data structure
- WebSocket connection required for main screen real-time updates
- Slide similarity pre-computation is essential for performance
- Room codes for session joining without authentication