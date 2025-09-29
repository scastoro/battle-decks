// Game state types
export type GamePhase = 'waiting' | 'presenting' | 'voting' | 'finished';
export type VoteChoice = 'logical' | 'chaotic';

// Deck processing types
export type DeckStatus = 'pending' | 'processing' | 'ready' | 'failed';

// Cloudflare Environment bindings (will be overridden by worker-configuration.d.ts)
export interface Env {
  GAME_SESSION: DurableObjectNamespace;
  SLIDES: R2Bucket;
  DECKS: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
}

// Slide data structure
export interface SlideData {
  id: string;
  title: string;
  imageUrl: string;
  logical: string[];  // Most similar slide IDs
  chaotic: string[];  // Least similar slide IDs
}

// Game session state (in-memory during DO lifecycle)
export interface GameState {
  sessionId: string;
  currentSlide: string;
  usedSlides: Set<string>;
  phase: GamePhase;
  votes: {
    logical: number;
    chaotic: number;
  };
  voters: Set<string>;
  votingOpen: boolean;
  timerEnd: number;
  timeRemaining?: number; // Optional for backwards compatibility
  slideCount: number;
  maxSlides: number;
}

// API request/response types
export interface VoteRequest {
  userId: string;
  choice: VoteChoice;
}

export interface VoteResult {
  success: boolean;
  error?: string;
  currentVotes?: {
    logical: number;
    chaotic: number;
  };
}

export interface GameStatusResponse {
  sessionId: string;
  currentSlide: string;
  phase: GamePhase;
  votes: {
    logical: number;
    chaotic: number;
  };
  timeRemaining: number;
  slideCount: number;
  votingOpen: boolean;
}

export interface StartGameRequest {
  deckId: string;
  maxSlides?: number;
}

// WebSocket message types
export type WebSocketMessageType =
  | 'gameState'
  | 'voteUpdate'
  | 'slideChange'
  | 'timerUpdate'
  | 'error'
  | 'pong';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  data: any;
  timestamp: number;
}

// SQL storage types (must align with SqlStorageValue)
export interface SqlRow {
  [key: string]: ArrayBuffer | string | number | null;
}

// SQLite schema types for type safety
export interface AdjacencyRecord extends SqlRow {
  slide_id: string;
  logical_slides: string; // JSON string
  chaotic_slides: string; // JSON string
}

export interface GameRecord extends SqlRow {
  session_id: string;
  current_slide: string;
  used_slides: string; // JSON string
  phase: string; // Will be cast to GamePhase
  slide_count: number;
  max_slides: number;
  timer_end: number;
  created_at: number;
  updated_at: number;
}

// Type guards for SQL results
export function isGameRecord(row: SqlRow): row is GameRecord {
  return typeof row === 'object' && row !== null &&
    typeof row.session_id === 'string' &&
    typeof row.current_slide === 'string' &&
    typeof row.used_slides === 'string' &&
    typeof row.phase === 'string' &&
    typeof row.slide_count === 'number' &&
    typeof row.max_slides === 'number' &&
    typeof row.timer_end === 'number';
}

export function isAdjacencyRecord(row: SqlRow): row is AdjacencyRecord {
  return typeof row === 'object' && row !== null &&
    typeof row.slide_id === 'string' &&
    typeof row.logical_slides === 'string' &&
    typeof row.chaotic_slides === 'string';
}

// WebSocket connection metadata (attached to WebSocket for hibernation)
export interface ConnectionMetadata {
  userId?: string;
  joinedAt: number;
  lastActivity: number;
}

// Deck management types
export interface DeckMetadata {
  deckId: string;
  name: string;
  description?: string;
  slideCount: number;
  status: DeckStatus;
  createdAt: number;
  processedAt?: number;
  error?: string;
}

export interface SlideEmbedding {
  slideId: string;
  embedding: number[];
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
  };
}

export interface ProcessingStatus {
  deckId: string;
  totalSlides: number;
  processedSlides: number;
  status: DeckStatus;
  currentStep?: string;
  error?: string;
}

export interface SimilarityScore {
  slideId: string;
  score: number;
}

export interface CreateDeckRequest {
  name: string;
  description?: string;
}

export interface CreateDeckResponse {
  success: boolean;
  deckId?: string;
  error?: string;
}

export interface UploadSlideRequest {
  slideId: string;
  image: ArrayBuffer;
  contentType: string;
}

export interface UploadSlideResponse {
  success: boolean;
  slideId?: string;
  error?: string;
}

export interface ProcessDeckRequest {
  deckId: string;
}

export interface ProcessDeckResponse {
  success: boolean;
  status?: ProcessingStatus;
  error?: string;
}