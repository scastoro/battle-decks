// Game state types
export type GamePhase = 'waiting' | 'presenting' | 'voting' | 'finished';
export type VoteChoice = 'logical' | 'chaotic';

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
  | 'error';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  data: any;
  timestamp: number;
}

// SQLite schema types for type safety
export interface AdjacencyRecord {
  slide_id: string;
  logical_slides: string; // JSON string
  chaotic_slides: string; // JSON string
}

export interface GameRecord {
  session_id: string;
  current_slide: string;
  used_slides: string; // JSON string
  phase: GamePhase;
  slide_count: number;
  max_slides: number;
  created_at: number;
  updated_at: number;
}

// WebSocket connection metadata (attached to WebSocket for hibernation)
export interface ConnectionMetadata {
  userId?: string;
  joinedAt: number;
  lastActivity: number;
}