# Battle Decks - Frontend Documentation

## Overview

The Battle Decks frontend consists of three distinct interfaces built with vanilla JavaScript and modern CSS. Each interface serves a specific role in the game experience and communicates with the backend via REST API and WebSockets.

## Interface Architecture

### 1. Voting Interface (`/vote`)
**File**: `public/vote.html`, `public/js/vote.js`
**Purpose**: Audience participation and voting interface

#### Features:
- **Room Code Entry**: Join games via 6-character codes
- **Real-time Voting**: Cast votes with instant feedback
- **Live Vote Counts**: See voting progress in real-time
- **Game Phase Awareness**: Different UI for each game phase
- **Responsive Design**: Mobile-first responsive layout

#### Key Components:

**VoteController Class**:
```javascript
class VoteController {
  constructor() {
    this.userId = 'user_' + Math.random().toString(36).substring(2, 11);
    this.ws = null; // WebSocket connection
    this.gameState = { /* current game state */ };
  }
}
```

**State Management**:
- Local user ID generation for vote tracking
- WebSocket connection with automatic reconnection
- Real-time game state synchronization
- Vote status tracking (submitted/pending)

**UI States**:
- **Join Panel**: Room code entry and session joining
- **Waiting**: Game hasn't started yet
- **Presenting**: Listening to presenter (45s countdown)
- **Voting**: Active voting interface (10s countdown)
- **Results**: Vote results display between rounds

#### WebSocket Message Handling:
- `gameState`: Update complete UI state
- `voteUpdate`: Update live vote counts
- `slideChange`: Visual feedback for slide transitions
- `error`: Display error messages to user

### 2. Admin Interface (`/admin`)
**File**: `public/admin.html`, `public/js/admin.js`
**Purpose**: Presenter control panel and game management

#### Features:
- **Session Creation**: Generate new game sessions
- **Game Controls**: Start, pause, reset game functionality
- **Live Dashboard**: Real-time game status monitoring
- **Presenter Tools**: Direct game management capabilities
- **Activity Logging**: Comprehensive event tracking

#### Key Components:

**AdminController Class**:
```javascript
class AdminController {
  constructor() {
    this.currentSession = null;
    this.gameState = { /* game state tracking */ };
    this.activityLog = []; // Event history
  }
}
```

**Control Panels**:
- **Session Management**: Create/manage game sessions
- **Game Controls**: Start game, configure slide count
- **Status Dashboard**: Live metrics and vote tracking
- **Quick Actions**: Copy codes, open display, download logs

**Real-time Features**:
- WebSocket connection for live updates
- Session age tracking and display
- Connected user count monitoring
- Live vote count visualization

#### Admin-Specific Functionality:
- Session URL generation and sharing
- Game parameter configuration (max slides)
- Real-time presenter feedback
- Activity log with downloadable history

### 3. Display Interface (`/display`)
**File**: `public/display.html`, `public/js/display.js`
**Purpose**: Main presentation display for audiences

#### Features:
- **Full-Screen Display**: Optimized for projection/large screens
- **Slide Presentation**: Dynamic slide loading and display
- **Timer Visualization**: Circular progress timer display
- **Vote Visualization**: Live voting progress bars
- **Phase Indicators**: Clear game phase communication

#### Key Components:

**DisplayController Class**:
```javascript
class DisplayController {
  constructor() {
    this.ws = null;
    this.gameState = { /* state tracking */ };
    this.timerInterval = null; // Timer management
  }
}
```

**Visual Components**:
- **Main Slide Area**: Central content display
- **Timer Display**: Circular progress with countdown
- **Vote Bars**: Real-time voting progress
- **Phase Indicators**: Current game phase display
- **Connection Status**: WebSocket connectivity indicator

#### Display Features:
- **Slide Loading**: Dynamic image loading from R2
- **Timer Animation**: Smooth countdown with color coding
- **Responsive Layout**: Adapts to different screen sizes
- **Connection Resilience**: Visual connection status indicators

## Shared Frontend Architecture

### WebSocket Management

All interfaces use a common WebSocket pattern:

```javascript
// Connection establishment
connectWebSocket(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/session/${sessionId}/ws`;
  this.ws = new WebSocket(wsUrl);
}

// Automatic reconnection with exponential backoff
reconnectWebSocket() {
  this.connectionAttempts++;
  const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
  setTimeout(() => this.connectWebSocket(this.currentSession), delay);
}
```

### State Synchronization

**Client-Side State Management**:
```javascript
this.gameState = {
  sessionId: null,
  currentSlide: null,
  phase: 'waiting',           // Game phase tracking
  votes: { logical: 0, chaotic: 0 },
  timeRemaining: 0,           // Countdown timer
  slideCount: 1,
  maxSlides: 10,
  votingOpen: false
};
```

### Error Handling

**Connection Resilience**:
- Automatic WebSocket reconnection
- Exponential backoff strategy (1s → 30s max)
- Visual connection status indicators
- Graceful degradation for offline scenarios

**User Feedback**:
- Toast notifications for success/error states
- Loading states during API calls
- Clear error messages for failed operations
- Connection status in all interfaces

## CSS Architecture

### Design System
**File**: `public/css/styles.css`

**CSS Custom Properties**:
```css
:root {
  --primary-color: #6366f1;
  --success-color: #10b981;
  --danger-color: #ef4444;
  --warning-color: #f59e0b;
}
```

**Component Patterns**:
- **Cards**: Glassmorphism design with backdrop-filter
- **Buttons**: Gradient backgrounds with hover animations
- **Inputs**: Consistent styling across all interfaces
- **Timers**: CSS animations for countdown visualization

### Responsive Design
- **Mobile-First**: Base styles for mobile devices
- **Progressive Enhancement**: Desktop enhancements
- **Flexible Layouts**: CSS Grid and Flexbox
- **Touch-Friendly**: Adequate button sizes for mobile

## Performance Optimizations

### Asset Loading
- **Critical CSS**: Inlined in HTML for faster rendering
- **Lazy Loading**: Non-critical resources loaded asynchronously
- **Image Optimization**: R2 serves optimized slide images
- **Caching**: 24-hour cache headers for static assets

### JavaScript Optimization
- **Vanilla JS**: No framework overhead
- **Event Delegation**: Efficient event handling
- **Debouncing**: Input handling optimization
- **Memory Management**: Proper WebSocket cleanup

### Real-time Performance
- **WebSocket Efficiency**: Minimal message overhead
- **DOM Updates**: Batched updates for smooth animations
- **Timer Accuracy**: Consistent countdown synchronization
- **Animation Performance**: CSS transforms for smooth effects

## Browser Compatibility

### Modern Browser Features
- **WebSockets**: Real-time communication
- **CSS Grid**: Layout system
- **ES6 Classes**: Modern JavaScript patterns
- **Fetch API**: HTTP requests
- **CSS Custom Properties**: Theming system

### Progressive Enhancement
- **Core Functionality**: Works without JavaScript (limited)
- **Enhanced Experience**: Full features with modern browsers
- **Graceful Degradation**: Fallbacks for older browsers
- **Mobile Optimization**: Touch and small screen support

## Security Considerations

### Client-Side Security
- **Content Security Policy**: Restricted script execution
- **CORS Compliance**: Proper cross-origin handling
- **Input Sanitization**: XSS prevention
- **Session Management**: Secure room code handling

### Data Privacy
- **No Personal Data**: User IDs are randomly generated
- **Session Isolation**: No cross-session data leakage
- **Temporary Storage**: No persistent local storage
- **Anonymous Voting**: No user identification required

## Development Workflow

### Local Development
- **Live Reload**: Instant updates during development
- **DevTools Integration**: Full debugging support
- **Console Logging**: Comprehensive debug information
- **WebSocket Debugging**: Connection state monitoring

### Testing Strategy
- **Manual Testing**: Cross-browser compatibility
- **Performance Testing**: Mobile device validation
- **Connection Testing**: Network resilience validation
- **User Experience**: Accessibility and usability testing