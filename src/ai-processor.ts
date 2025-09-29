import {
  Env,
  SlideEmbedding,
  SimilarityScore,
  AdjacencyRecord,
} from './types/index';

/**
 * AI Processor for Battle Decks
 *
 * Handles:
 * - Generating embeddings from slide images using Cloudflare Workers AI
 * - Calculating similarity between slides
 * - Building adjacency lists (logical vs chaotic relationships)
 * - Storing processed data to KV
 *
 * Architecture:
 * 1. Image → LLaVA (image-to-text) → Text description
 * 2. Text description → BGE (text-to-embedding) → Vector embedding
 */

// Cloudflare Workers AI models
const IMAGE_TO_TEXT_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const TEXT_EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

/**
 * Generate an embedding vector for a slide image
 * Uses a two-step process:
 * 1. Image-to-text: Generate description using LLaVA
 * 2. Text-to-embedding: Create vector using BGE
 */
export async function generateEmbedding(
  imageBuffer: ArrayBuffer,
  env: Env
): Promise<number[]> {
  try {
    // Step 1: Generate text description from image using LLaVA
    const imageArray = Array.from(new Uint8Array(imageBuffer));

    const visionResponse = await env.AI.run(IMAGE_TO_TEXT_MODEL, {
      image: imageArray,
      prompt: 'Describe this slide in detail, including any text, diagrams, images, and key concepts shown.',
      max_tokens: 256,
    }) as { description: string };

    if (!visionResponse || !visionResponse.description) {
      throw new Error('Failed to generate image description');
    }

    const description = visionResponse.description;
    console.log(`Generated description: ${description.substring(0, 100)}...`);

    // Step 2: Generate embedding from text description using BGE
    const embeddingResponse = await env.AI.run(TEXT_EMBEDDING_MODEL, {
      text: description,
    }) as { shape: number[]; data: number[][] };

    if (!embeddingResponse || !embeddingResponse.data || !Array.isArray(embeddingResponse.data[0])) {
      throw new Error('Invalid embedding response from AI model');
    }

    // Return the first embedding (we only sent one text)
    return embeddingResponse.data[0];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating embedding:', errorMessage);
    throw new Error(`Failed to generate embedding: ${errorMessage}`);
  }
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns a value between -1 and 1 (higher = more similar)
 */
export function calculateSimilarity(
  embedding1: number[],
  embedding2: number[]
): number {
  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings must have the same dimension');
  }

  // Calculate dot product
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    magnitude1 += embedding1[i] * embedding1[i];
    magnitude2 += embedding2[i] * embedding2[i];
  }

  // Calculate magnitudes
  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  // Avoid division by zero
  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  // Return cosine similarity
  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Generate adjacency list for all slides
 * Creates logical (similar) and chaotic (dissimilar) relationships
 */
export function generateAdjacencyList(
  embeddings: SlideEmbedding[]
): Record<string, { logical: string[]; chaotic: string[] }> {
  const adjacencyList: Record<string, { logical: string[]; chaotic: string[] }> = {};

  // For each slide, calculate similarity with all other slides
  for (const slide1 of embeddings) {
    const similarities: SimilarityScore[] = [];

    for (const slide2 of embeddings) {
      // Skip comparing slide with itself
      if (slide1.slideId === slide2.slideId) {
        continue;
      }

      const similarity = calculateSimilarity(slide1.embedding, slide2.embedding);
      similarities.push({
        slideId: slide2.slideId,
        score: similarity,
      });
    }

    // Sort by similarity score (high to low)
    similarities.sort((a, b) => b.score - a.score);

    // Top 3 = most similar (logical)
    const logical = similarities.slice(0, 3).map(s => s.slideId);

    // Bottom 3 = least similar (chaotic)
    const chaotic = similarities.slice(-3).reverse().map(s => s.slideId);

    adjacencyList[slide1.slideId] = {
      logical,
      chaotic,
    };
  }

  return adjacencyList;
}

/**
 * Store adjacency list data to KV namespace
 * Saves the pre-computed slide relationships for runtime use
 */
export async function storeAdjacencyList(
  deckId: string,
  adjacencyData: Record<string, { logical: string[]; chaotic: string[] }>,
  env: Env
): Promise<void> {
  try {
    // Store the complete adjacency list under a single key
    const key = `deck:${deckId}:adjacency`;
    await env.DECKS.put(key, JSON.stringify(adjacencyData));

    console.log(`✅ Stored adjacency list for deck ${deckId} in KV`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error storing adjacency list:', errorMessage);
    throw new Error(`Failed to store adjacency list: ${errorMessage}`);
  }
}

/**
 * Load adjacency list from KV namespace
 * Retrieves pre-computed slide relationships for a deck
 */
export async function loadAdjacencyList(
  deckId: string,
  env: Env
): Promise<Record<string, { logical: string[]; chaotic: string[] }> | null> {
  try {
    const key = `deck:${deckId}:adjacency`;
    const data = await env.DECKS.get(key);

    if (!data) {
      console.log(`❌ No adjacency list found for deck ${deckId}`);
      return null;
    }

    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading adjacency list:', error);
    return null;
  }
}

/**
 * Process a complete deck: generate embeddings and build adjacency lists
 * This is the main orchestration function for AI processing
 */
export async function processDeck(
  deckId: string,
  slideIds: string[],
  env: Env
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`🔄 Processing deck ${deckId} with ${slideIds.length} slides...`);

    const embeddings: SlideEmbedding[] = [];

    // Step 1: Generate embeddings for all slides
    for (let i = 0; i < slideIds.length; i++) {
      const slideId = slideIds[i];
      console.log(`📊 Processing slide ${i + 1}/${slideIds.length}: ${slideId}`);

      // Fetch slide image from R2
      const imageKey = `decks/${deckId}/${slideId}`;
      const r2Object = await env.SLIDES.get(imageKey);

      if (!r2Object) {
        throw new Error(`Slide image not found in R2: ${imageKey}`);
      }

      const imageBuffer = await r2Object.arrayBuffer();

      // Generate embedding
      const embedding = await generateEmbedding(imageBuffer, env);

      embeddings.push({
        slideId,
        embedding,
      });

      // Optional: Store individual embeddings for future use
      await env.DECKS.put(
        `deck:${deckId}:embedding:${slideId}`,
        JSON.stringify({ slideId, embedding })
      );
    }

    // Step 2: Generate adjacency list from embeddings
    console.log(`🔗 Generating adjacency list for ${embeddings.length} slides...`);
    const adjacencyList = generateAdjacencyList(embeddings);

    // Step 3: Store adjacency list to KV
    await storeAdjacencyList(deckId, adjacencyList, env);

    console.log(`✅ Successfully processed deck ${deckId}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during deck processing';
    console.error(`❌ Error processing deck ${deckId}:`, errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}