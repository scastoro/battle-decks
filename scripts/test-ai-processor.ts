#!/usr/bin/env node

/**
 * Test script for AI processing pipeline
 *
 * Tests:
 * 1. Cosine similarity calculation
 * 2. Adjacency list generation
 * 3. Basic data structure validation
 */

import { calculateSimilarity, generateAdjacencyList } from '../src/ai-processor';
import { SlideEmbedding } from '../src/types/index';

/**
 * Test 1: Cosine similarity calculation
 */
function testCosineSimilarity() {
  console.log('\n🧪 Test 1: Cosine Similarity Calculation');
  console.log('─'.repeat(50));

  // Test case 1: Identical vectors (should return 1.0)
  const vec1 = [1, 2, 3];
  const vec2 = [1, 2, 3];
  const sim1 = calculateSimilarity(vec1, vec2);
  console.log(`✓ Identical vectors: ${sim1.toFixed(4)} (expected: 1.0000)`);
  if (Math.abs(sim1 - 1.0) > 0.0001) {
    throw new Error('Failed: Identical vectors should have similarity of 1.0');
  }

  // Test case 2: Orthogonal vectors (should return 0.0)
  const vec3 = [1, 0, 0];
  const vec4 = [0, 1, 0];
  const sim2 = calculateSimilarity(vec3, vec4);
  console.log(`✓ Orthogonal vectors: ${sim2.toFixed(4)} (expected: 0.0000)`);
  if (Math.abs(sim2 - 0.0) > 0.0001) {
    throw new Error('Failed: Orthogonal vectors should have similarity of 0.0');
  }

  // Test case 3: Opposite vectors (should return -1.0)
  const vec5 = [1, 2, 3];
  const vec6 = [-1, -2, -3];
  const sim3 = calculateSimilarity(vec5, vec6);
  console.log(`✓ Opposite vectors: ${sim3.toFixed(4)} (expected: -1.0000)`);
  if (Math.abs(sim3 - (-1.0)) > 0.0001) {
    throw new Error('Failed: Opposite vectors should have similarity of -1.0');
  }

  // Test case 4: Similar vectors
  const vec7 = [1, 2, 3, 4, 5];
  const vec8 = [1.1, 2.1, 2.9, 4.2, 4.8];
  const sim4 = calculateSimilarity(vec7, vec8);
  console.log(`✓ Similar vectors: ${sim4.toFixed(4)} (expected: ~0.9999)`);
  if (sim4 < 0.99) {
    throw new Error('Failed: Similar vectors should have high similarity');
  }

  console.log('✅ All cosine similarity tests passed!');
}

/**
 * Test 2: Adjacency list generation
 */
function testAdjacencyList() {
  console.log('\n🧪 Test 2: Adjacency List Generation');
  console.log('─'.repeat(50));

  // Create mock embeddings for 6 slides
  const embeddings: SlideEmbedding[] = [
    { slideId: 'slide_1', embedding: [1, 0, 0, 0, 0] },  // Tech slides cluster
    { slideId: 'slide_2', embedding: [0.9, 0.1, 0, 0, 0] },
    { slideId: 'slide_3', embedding: [0, 0, 1, 0, 0] },  // Business slides cluster
    { slideId: 'slide_4', embedding: [0, 0, 0.95, 0.05, 0] },
    { slideId: 'slide_5', embedding: [0, 0, 0, 0, 1] },  // Random slide
    { slideId: 'slide_6', embedding: [0.85, 0.15, 0, 0, 0] },  // Tech slides cluster
  ];

  const adjacencyList = generateAdjacencyList(embeddings);

  // Validate structure
  console.log('✓ Adjacency list structure:');
  for (const slideId of Object.keys(adjacencyList)) {
    const entry = adjacencyList[slideId];
    console.log(`  ${slideId}:`);
    console.log(`    logical:  [${entry.logical.join(', ')}]`);
    console.log(`    chaotic:  [${entry.chaotic.join(', ')}]`);

    // Validate that each slide has exactly 3 logical and 3 chaotic neighbors
    if (entry.logical.length !== 3) {
      throw new Error(`Failed: ${slideId} should have exactly 3 logical neighbors`);
    }
    if (entry.chaotic.length !== 3) {
      throw new Error(`Failed: ${slideId} should have exactly 3 chaotic neighbors`);
    }

    // Validate that slide doesn't reference itself
    if (entry.logical.includes(slideId) || entry.chaotic.includes(slideId)) {
      throw new Error(`Failed: ${slideId} should not reference itself`);
    }
  }

  // Validate specific expected relationships
  // slide_1 should be most similar to slide_2 and slide_6 (tech cluster)
  const slide1Adjacency = adjacencyList['slide_1'];
  if (!slide1Adjacency.logical.includes('slide_2')) {
    console.warn('⚠️  Warning: slide_1 logical neighbors may not be optimal');
  }
  if (!slide1Adjacency.logical.includes('slide_6')) {
    console.warn('⚠️  Warning: slide_1 logical neighbors may not be optimal');
  }

  // slide_1 should be most dissimilar to slide_3, slide_4, slide_5
  if (!slide1Adjacency.chaotic.includes('slide_5')) {
    console.warn('⚠️  Warning: slide_1 chaotic neighbors may not be optimal');
  }

  console.log('✅ Adjacency list generation tests passed!');
}

/**
 * Test 3: Data validation
 */
function testDataValidation() {
  console.log('\n🧪 Test 3: Data Validation');
  console.log('─'.repeat(50));

  // Test error handling for mismatched embedding dimensions
  try {
    const vec1 = [1, 2, 3];
    const vec2 = [1, 2];  // Wrong dimension
    calculateSimilarity(vec1, vec2);
    throw new Error('Should have thrown error for mismatched dimensions');
  } catch (error) {
    if (error instanceof Error && error.message.includes('same dimension')) {
      console.log('✓ Correctly handles mismatched embedding dimensions');
    } else {
      throw error;
    }
  }

  // Test zero vector handling
  const zeroVec = [0, 0, 0];
  const normalVec = [1, 2, 3];
  const simZero = calculateSimilarity(zeroVec, normalVec);
  console.log(`✓ Zero vector similarity: ${simZero.toFixed(4)} (expected: 0.0000)`);
  if (simZero !== 0) {
    throw new Error('Failed: Zero vector should return 0 similarity');
  }

  console.log('✅ Data validation tests passed!');
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n🚀 Battle Decks AI Processor Tests');
  console.log('═'.repeat(50));

  try {
    testCosineSimilarity();
    testAdjacencyList();
    testDataValidation();

    console.log('\n' + '═'.repeat(50));
    console.log('🎉 All tests passed successfully!');
    console.log('═'.repeat(50));
    console.log('\n📝 Notes:');
    console.log('  - Core mathematical functions are working correctly');
    console.log('  - Adjacency list generation logic is validated');
    console.log('  - To test full pipeline with Workers AI:');
    console.log('    1. Start wrangler dev: npm run dev');
    console.log('    2. Use process-deck script: npm run process-deck');
    console.log('\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});