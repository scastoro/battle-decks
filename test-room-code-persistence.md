# Testing Room Code Persistence

## Problem Reproduction
The issue was that when alarms fired after DO hibernation/restart, `this.roomCode` would be null, causing the wrong session ID to be used in SQLite queries.

## Solution Implemented
1. **Metadata Table**: Added `do_metadata` table to store room code persistently
2. **Constructor Recovery**: Room code is recovered during DO construction using `blockConcurrencyWhile`
3. **Alarm Handler Recovery**: Alarm handler explicitly recovers room code if missing
4. **Initialization Storage**: Room code is stored when `initialize()` is called with a room code

## Test Steps

### 1. Create a Session
```bash
curl -X POST http://localhost:8787/create-session
# Expected: { "sessionId": "ABC123", "success": true }
```

### 2. Start a Game (Sets Alarm)
```bash
curl -X POST http://localhost:8787/session/ABC123/start \
  -H "Content-Type: application/json" \
  -d '{"deckId": "test", "maxSlides": 2}'
# Expected: Game starts, 45-second alarm is set
```

### 3. Wait for Alarm to Fire
- Wait 45 seconds for presentation timer
- Check logs for: "✅ Recovered room code: ABC123 after DO restart"
- Verify: Voting phase begins

### 4. Force DO Restart (Simulate Hibernation)
```bash
# Deploy to force restart
wrangler publish

# Check if session still works
curl http://localhost:8787/session/ABC123/status
# Expected: Session data recovered correctly
```

## Expected Log Output
```
🔔 Alarm handler triggered, checking room code...
✅ Recovered room code: ABC123 after DO restart
🔔 Room code status: Found: ABC123
🔔 Processing alarm for session ABC123, phase: presenting
```

## Key Files Modified
- `/Users/scastoro/repos/battle-decks/src/game-session.ts`
  - Added `do_metadata` table
  - Added `storeRoomCode()` and `recoverRoomCodeFromStorage()` methods
  - Enhanced alarm handler with room code recovery
  - Improved error handling and logging

## Alternative Solutions (Not Implemented)
1. **KV Storage**: Use `ctx.storage.put('room_code', roomCode)` instead of SQLite
2. **Name Encoding**: Encode room code in the DO ID itself
3. **Session Table Primary Key**: Use DO ID as primary key, store room code as column
4. **Environment Variable**: Pass room code via alarm scheduling (not supported by API)