// Game state types
export type GamePhase = 'waiting' | 'presenting' | 'voting' | 'finished';
export type VoteChoice = 'logical' | 'chaotic';

// Cloudflare Environment bindings (will be overridden by worker-configuration.d.ts)
export interface Env {
  GAME_SESSION: DurableObjectNamespace;
  SLIDES: R2Bucket;
  AI: Ai;
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
    typeof row.max_slides === 'number';
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