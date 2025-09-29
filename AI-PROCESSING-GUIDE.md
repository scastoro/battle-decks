# Battle Decks - AI Image Processing Guide

This guide explains how the AI-powered slide processing system works and how to use it.

## Overview

Battle Decks uses Cloudflare Workers AI to analyze slide images and create relationships between slides. The system generates "logical" (similar) and "chaotic" (dissimilar) connections that drive the game's voting mechanics.

## Architecture

### Two-Phase Design

#### 1. Setup Phase (One-time per deck)
```
Upload slides → Generate embeddings → Calculate similarities → Store adjacency lists
```

The setup phase pre-computes all slide relationships to avoid real-time AI processing during games.

#### 2. Runtime Phase
```
Load adjacency data → Game logic uses pre-computed relationships → Fast slide transitions
```

During gameplay, the system simply looks up pre-computed relationships from KV storage.

---

## Components

### 1. AI Processor (`src/ai-processor.ts`)

Core module for AI processing:

**Key Functions:**
- `generateEmbedding(imageBuffer, env)` - Creates embedding vectors using a two-step process
- `calculateSimilarity(embedding1, embedding2)` - Computes cosine similarity between vectors
- `generateAdjacencyList(embeddings)` - Builds logical/chaotic relationships
- `storeAdjacencyList(deckId, adjacencyData, env)` - Saves to KV storage
- `processDeck(deckId, slideIds, env)` - Main orchestration function

**AI Models Used:**
- `@cf/llava-hf/llava-1.5-7b-hf` - Image-to-text (vision) model - Generates descriptions from slide images
- `@cf/baai/bge-base-en-v1.5` - Text embedding model - Creates vector embeddings from descriptions

**Why Two Steps?**
Cloudflare Workers AI doesn't provide direct image-to-embedding models. Instead, we use:
1. **Vision model (LLaVA)** to understand slide content and generate text descriptions
2. **Text embedding model (BGE)** to convert descriptions into vector embeddings

This approach is actually better for slides because it captures semantic meaning of text, diagrams, and visual elements.

### 2. Deck Management API (`src/index.ts`)

RESTful API endpoints for deck operations:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/decks/create` | POST | Create new deck |
| `/api/decks/:deckId/upload-slide` | POST | Upload slide image to R2 |
| `/api/decks/:deckId/process` | POST | Trigger AI processing |
| `/api/decks/:deckId/status` | GET | Check processing progress |
| `/api/decks` | GET | List all decks |
| `/api/decks/:deckId` | DELETE | Delete deck |

### 3. Batch Processing Script (`scripts/process-slides.ts`)

Command-line tool for processing slides from local directories.

**Usage:**
```bash
npm run process-deck -- --deck-name "My Deck" --slides-dir ./slides
```

**Workflow:**
1. Creates deck via API
2. Uploads all slides from directory to R2
3. Triggers AI processing
4. Monitors progress until complete

### 4. Admin Interface (`public/admin.html` + `public/js/admin.js`)

Web UI for deck management:
- Load and display available decks
- Select deck for game
- Monitor processing status
- View deck metadata

---

## Data Structures

### Deck Metadata (stored in KV)
```typescript
{
  deckId: "deck_123456789_abc123",
  name: "Tech Conference 2025",
  description: "Conference presentation slides",
  slideCount: 50,
  status: "ready",  // pending | processing | ready | failed
  createdAt: 1234567890,
  processedAt: 1234567899
}
```

### Slide Embeddings (stored in KV)
```typescript
{
  slideId: "slide_1",
  embedding: [0.123, -0.456, 0.789, ...],  // 768-dimension vector
  metadata: {
    width: 1920,
    height: 1080,
    format: "image/jpeg"
  }
}
```

### Adjacency List (stored in KV)
```typescript
{
  "slide_1": {
    logical: ["slide_5", "slide_8", "slide_12"],   // Top 3 most similar
    chaotic: ["slide_34", "slide_39", "slide_41"]  // Bottom 3 least similar
  },
  "slide_2": {
    logical: ["slide_1", "slide_6", "slide_9"],
    chaotic: ["slide_45", "slide_33", "slide_28"]
  }
  // ... for all slides
}
```

---

## Storage Layout

### R2 Bucket (Slide Images)
```
decks/
  ├── deck_123456789_abc123/
  │   ├── slide_1.jpg
  │   ├── slide_2.jpg
  │   └── slide_3.jpg
  └── deck_987654321_xyz789/
      ├── slide_1.png
      └── slide_2.png
```

### KV Namespace (Metadata)
```
deck:deck_123456789_abc123:metadata          → DeckMetadata JSON
deck:deck_123456789_abc123:adjacency         → Complete adjacency list
deck:deck_123456789_abc123:embedding:slide_1 → Individual embedding (optional)
deck:deck_123456789_abc123:embedding:slide_2 → Individual embedding (optional)
```

---

## How It Works

### Similarity Calculation

The system uses a **two-step process** followed by **cosine similarity**:

1. **Image → Text:** LLaVA vision model analyzes each slide and generates a detailed text description (up to 256 tokens)
2. **Text → Vector:** BGE text embedding model converts descriptions into 768-dimensional vectors
3. **Similarity:** Compare vectors using cosine similarity formula:
   ```
   similarity = (A · B) / (||A|| × ||B||)
   ```
4. Result ranges from -1 (opposite) to 1 (identical)

**Example Processing:**
- Slide 1 (technical diagram) → "A diagram showing cloud architecture with database, API server, and front-end components..." → [0.123, -0.456, ...]
- Slide 2 (similar topic) → "System architecture diagram depicting microservices with database connections..." → [0.145, -0.432, ...]
- High similarity score → These become "logical" options for each other

### Adjacency List Generation

For each slide:
1. Calculate similarity with ALL other slides
2. Sort by similarity score (high to low)
3. Select top 3 → "logical" options (most similar)
4. Select bottom 3 → "chaotic" options (least similar)

This ensures:
- **Logical votes** → natural progression, related content
- **Chaotic votes** → unexpected jumps, comedic effect

---

## Processing Workflow

### Via Batch Script

```bash
# 1. Install dependencies
npm install

# 2. Prepare slides
# Place slides in a directory, named: slide_1.jpg, slide_2.png, etc.

# 3. Run processing script
npm run process-deck -- \
  --deck-name "My Presentation" \
  --slides-dir ./my-slides \
  --description "Conference talk about AI"

# 4. Script will:
#    - Create deck
#    - Upload slides to R2
#    - Generate embeddings
#    - Build adjacency lists
#    - Store in KV
```

### Via Admin UI (Future)

1. Navigate to admin interface
2. Click "Upload Deck"
3. Select multiple slide images
4. Wait for processing
5. Select deck for game

---

## API Usage Examples

### Create Deck
```javascript
const response = await fetch('/api/decks/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My Deck',
    description: 'Optional description'
  })
});

const { deckId } = await response.json();
```

### Upload Slide
```javascript
const formData = new FormData();
formData.append('slideId', 'slide_1');
formData.append('image', imageFile);

await fetch(`/api/decks/${deckId}/upload-slide`, {
  method: 'POST',
  body: formData
});
```

### Process Deck
```javascript
await fetch(`/api/decks/${deckId}/process`, {
  method: 'POST'
});
```

### Check Status
```javascript
const response = await fetch(`/api/decks/${deckId}/status`);
const status = await response.json();

console.log(status.status);  // 'processing' | 'ready' | 'failed'
console.log(`${status.processedSlides}/${status.totalSlides} slides`);
```

---

## Performance Considerations

### Processing Time
- **Per slide:** ~4-8 seconds (2-4s for image description + 2-4s for embedding generation)
- **50 slides:** ~4-7 minutes total processing time
- Processing happens asynchronously in the background
- Two AI model calls per slide (LLaVA + BGE)

### Storage Requirements
- **R2:** ~100KB per slide image (varies by resolution/format)
- **KV:**
  - Metadata: ~1KB per deck
  - Embeddings: ~3KB per slide (768 floats)
  - Adjacency list: ~2KB for 50 slides

### Cost Estimates (for reference)
- Workers AI: Included in Cloudflare plan
- R2: $0.015/GB storage, $0.36/million writes
- KV: $0.50/GB storage, $0.50/million writes
- **Typical deck:** < $0.01 to process and store

---

## Troubleshooting

### "Deck processing failed"
- Check worker logs: `npm run tail`
- Verify slides are valid image formats (JPEG, PNG)
- Ensure R2 bucket and KV namespace are configured
- Check Cloudflare Workers AI is enabled

### "Embedding generation error"
- Verify Workers AI binding is configured in `wrangler.toml`
- Check image file size (should be < 10MB)
- Try with different image format

### "Adjacency list not found"
- Ensure deck status is "ready" before starting game
- Check KV namespace contains `deck:{deckId}:adjacency` key
- Re-run processing if needed

---

## Development

### Testing Locally

```bash
# Start local development server
npm run dev

# In another terminal, process test deck
npm run process-deck -- \
  --deck-name "Test Deck" \
  --slides-dir ./test-slides \
  --worker-url http://localhost:8787
```

### Viewing Logs

```bash
# Local development (wrangler dev)
# Logs appear in terminal

# Production
npm run tail
```

---

## Best Practices

1. **Slide Naming:** Use sequential naming (slide_1, slide_2, etc.) for consistency
2. **Image Format:** JPEG recommended for smaller file sizes
3. **Resolution:** 1920x1080 or 1280x720 works well
4. **Slide Count:** 30-50 slides per deck is optimal for gameplay
5. **Processing:** Always wait for "ready" status before starting game
6. **Testing:** Test with small deck (5-10 slides) first

---

## Future Enhancements

- [ ] Support for slide text extraction (OCR)
- [ ] Manual slide relationship editing
- [ ] Multiple embedding models to choose from
- [ ] Thumbnail generation
- [ ] Batch deck upload via UI
- [ ] Slide preview in admin interface
- [ ] Advanced similarity tuning parameters

---

## Technical Notes

### Why Pre-compute?
Real-time AI processing during games would cause delays. Pre-computation ensures:
- **Instant slide transitions** (< 100ms)
- **Predictable performance**
- **Lower AI costs**

### Why Two-Step Processing?
The image → text → embedding approach has several advantages:
- **Better semantic understanding:** Vision models capture text, diagrams, and visual concepts
- **Works with slides:** Most slides contain text and structured content, which LLaVA excels at describing
- **Leverages best models:** Combines specialized vision and embedding models
- **Cloudflare native:** Uses only Cloudflare Workers AI models (no external dependencies)

### Why Cosine Similarity?
Cosine similarity is ideal for high-dimensional embeddings because:
- Focuses on direction, not magnitude
- Works well with normalized vectors
- Computationally efficient
- Standard in ML/AI applications

### Edge Cases Handled
- **Insufficient options:** Fallback to random unused slides
- **All slides used:** Game ends gracefully
- **Processing failures:** Status tracked, can retry
- **Concurrent uploads:** Each slide upload is atomic

---

## Support

For issues or questions:
1. Check worker logs first
2. Verify all Cloudflare resources are configured
3. Review this guide for common solutions
4. Check GitHub issues for similar problems