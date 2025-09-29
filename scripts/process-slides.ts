#!/usr/bin/env node

/**
 * Batch Slide Processing Script for Battle Decks
 *
 * Uploads slides from a local directory to Cloudflare R2 and triggers AI processing.
 *
 * Usage:
 *   npm run process-deck -- --deck-name "My Deck" --slides-dir ./slides
 *   npm run process-deck -- --deck-name "Tech Talk" --slides-dir ./slides --description "Conference slides"
 *
 * Requirements:
 * - wrangler must be installed and configured
 * - Slides must be named sequentially (slide_1.jpg, slide_2.png, etc.)
 * - Supported formats: .jpg, .jpeg, .png
 */

import * as fs from 'fs';
import * as path from 'path';

interface ProcessOptions {
  deckName: string;
  slidesDir: string;
  description?: string;
  workerUrl?: string;
}

interface ApiResponse {
  success: boolean;
  error?: string;
  deckId?: string;
}

interface ProcessingStatus {
  deckId: string;
  totalSlides: number;
  processedSlides: number;
  status: string;
  currentStep?: string;
  error?: string;
}

/**
 * Main entry point for the script
 */
async function main() {
  const args = parseArguments();

  if (!args.deckName || !args.slidesDir) {
    console.error('❌ Missing required arguments');
    printUsage();
    process.exit(1);
  }

  // Validate slides directory
  if (!fs.existsSync(args.slidesDir)) {
    console.error(`❌ Slides directory not found: ${args.slidesDir}`);
    process.exit(1);
  }

  // Determine worker URL
  const workerUrl = args.workerUrl || getWorkerUrl();
  console.log(`🔗 Using worker URL: ${workerUrl}`);

  try {
    // Step 1: Create deck
    console.log(`\n📦 Creating deck: ${args.deckName}`);
    const deckId = await createDeck(workerUrl, args.deckName, args.description);
    console.log(`✅ Deck created with ID: ${deckId}`);

    // Step 2: Upload slides
    console.log(`\n📤 Uploading slides from: ${args.slidesDir}`);
    const slideFiles = getSlideFiles(args.slidesDir);
    console.log(`Found ${slideFiles.length} slide files`);

    for (let i = 0; i < slideFiles.length; i++) {
      const file = slideFiles[i];
      const slideId = `slide_${i + 1}`;
      console.log(`  [${i + 1}/${slideFiles.length}] Uploading ${file.name} as ${slideId}...`);
      await uploadSlide(workerUrl, deckId, slideId, file.path);
    }

    console.log(`✅ Uploaded ${slideFiles.length} slides`);

    // Step 3: Trigger AI processing
    console.log(`\n🤖 Triggering AI processing for deck ${deckId}...`);
    await processDeck(workerUrl, deckId);

    // Step 4: Monitor processing status
    console.log(`\n⏳ Monitoring processing status...`);
    await monitorProcessing(workerUrl, deckId);

    console.log(`\n🎉 Deck processing complete!`);
    console.log(`\n📝 Deck ID: ${deckId}`);
    console.log(`🎮 You can now start a game with this deck in the admin interface`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Parse command-line arguments
 */
function parseArguments(): ProcessOptions {
  const args = process.argv.slice(2);
  const options: ProcessOptions = {
    deckName: '',
    slidesDir: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--deck-name' && args[i + 1]) {
      options.deckName = args[i + 1];
      i++;
    } else if (arg === '--slides-dir' && args[i + 1]) {
      options.slidesDir = args[i + 1];
      i++;
    } else if (arg === '--description' && args[i + 1]) {
      options.description = args[i + 1];
      i++;
    } else if (arg === '--worker-url' && args[i + 1]) {
      options.workerUrl = args[i + 1];
      i++;
    }
  }

  return options;
}

/**
 * Get worker URL from wrangler.toml or use default
 */
function getWorkerUrl(): string {
  // Try to read from environment or use local development URL
  const envUrl = process.env.WORKER_URL;
  if (envUrl) {
    return envUrl;
  }

  // Default to local development
  return 'http://localhost:8787';
}

/**
 * Get list of slide files from directory
 */
function getSlideFiles(dir: string): Array<{ name: string; path: string }> {
  const files = fs.readdirSync(dir);
  const slideFiles = files
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png'].includes(ext);
    })
    .sort()
    .map(file => ({
      name: file,
      path: path.join(dir, file),
    }));

  return slideFiles;
}

/**
 * Create a new deck
 */
async function createDeck(
  workerUrl: string,
  name: string,
  description?: string
): Promise<string> {
  const response = await fetch(`${workerUrl}/api/decks/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create deck: ${response.statusText}`);
  }

  const data: ApiResponse = await response.json();

  if (!data.success || !data.deckId) {
    throw new Error(data.error || 'Failed to create deck');
  }

  return data.deckId;
}

/**
 * Upload a single slide
 */
async function uploadSlide(
  workerUrl: string,
  deckId: string,
  slideId: string,
  filePath: string
): Promise<void> {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append('slideId', slideId);
  formData.append('image', blob, path.basename(filePath));

  const response = await fetch(`${workerUrl}/api/decks/${deckId}/upload-slide`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload slide ${slideId}: ${response.statusText}`);
  }

  const data: ApiResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || `Failed to upload slide ${slideId}`);
  }
}

/**
 * Trigger deck processing
 */
async function processDeck(workerUrl: string, deckId: string): Promise<void> {
  const response = await fetch(`${workerUrl}/api/decks/${deckId}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to start processing: ${response.statusText}`);
  }

  const data: ApiResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to start processing');
  }
}

/**
 * Monitor processing status with polling
 */
async function monitorProcessing(workerUrl: string, deckId: string): Promise<void> {
  const maxRetries = 60; // 5 minutes with 5-second intervals
  let retries = 0;

  while (retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

    const response = await fetch(`${workerUrl}/api/decks/${deckId}/status`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`);
    }

    const status: ProcessingStatus = await response.json();

    console.log(
      `  Status: ${status.status} | Processed: ${status.processedSlides}/${status.totalSlides}`
    );

    if (status.status === 'ready') {
      console.log('✅ Processing complete!');
      return;
    }

    if (status.status === 'failed') {
      throw new Error(`Processing failed: ${status.error || 'Unknown error'}`);
    }

    retries++;
  }

  throw new Error('Processing timeout - check worker logs for details');
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Usage: npm run process-deck -- [options]

Options:
  --deck-name <name>         Name of the deck (required)
  --slides-dir <path>        Path to directory containing slides (required)
  --description <text>       Optional deck description
  --worker-url <url>         Worker URL (default: http://localhost:8787)

Examples:
  npm run process-deck -- --deck-name "My Deck" --slides-dir ./slides
  npm run process-deck -- --deck-name "Tech Talk" --slides-dir ./slides --description "Conference presentation"

Notes:
  - Slides must be named in order (slide_1.jpg, slide_2.png, etc.)
  - Supported formats: .jpg, .jpeg, .png
  - Make sure wrangler dev is running or specify production worker URL
  `);
}

// Run the script
main().catch(error => {
  console.error(`\n💥 Unexpected error:`, error);
  process.exit(1);
});