# Battle Decks - Deployment & Configuration Documentation

## Overview

Battle Decks is deployed on Cloudflare's global edge network using Workers, Durable Objects, R2, and KV. The deployment process is automated through Wrangler CLI with environment-specific configurations.

## Infrastructure Components

### 1. Cloudflare Services

**Cloudflare Workers**
- Global edge deployment across 300+ locations
- Automatic scaling and load balancing
- V8 JavaScript runtime with TypeScript support
- 100ms CPU limit per request (sufficient for Battle Decks)

**Durable Objects**
- SQLite-backed persistent storage
- Single-threaded execution guarantees
- WebSocket hibernation support
- Automatic migration with `new_sqlite_classes`

**R2 Object Storage**
- S3-compatible API for slide images
- Global edge caching
- No egress fees for data transfer
- Automatic image optimization

**KV Namespace**
- Key-value storage for metadata
- Eventually consistent global distribution
- Optimized for read-heavy workloads
- Automatic edge caching

**Workers AI**
- Text embedding generation for slide similarity
- Pay-per-use pricing model
- Integrated with Workers runtime
- Support for multiple AI models

### 2. Configuration Files

#### wrangler.toml Structure

```toml
name = "battle-decks"
main = "src/index.ts"
compatibility_date = "2025-09-23"

# Static assets configuration
[assets]
directory = "public"
binding = "ASSETS"

# Durable Objects configuration
[[durable_objects.bindings]]
name = "GAME_SESSION"
class_name = "GameSession"

# SQLite migration
[[migrations]]
tag = "v1"
new_sqlite_classes = ["GameSession"]

# R2 bucket binding
[[r2_buckets]]
binding = "SLIDES"
bucket_name = "battle-decks-slides"

# KV namespace binding
[[kv_namespaces]]
binding = "DECKS"
id = "6a330a42e7b94f3ab1d3822fb8f26249"

# Workers AI binding
[ai]
binding = "AI"
```

#### Environment Configurations

**Production Environment**:
- Worker Name: `battle-decks`
- Domain: Custom domain with SSL
- R2 Bucket: `battle-decks-slides`
- KV Namespace: Production namespace ID

**Staging Environment**:
```toml
[env.staging]
name = "battle-decks-staging"

[[env.staging.r2_buckets]]
binding = "SLIDES"
bucket_name = "battle-decks-slides-staging"

[[env.staging.kv_namespaces]]
binding = "DECKS"
id = "4d165302f20042d18ab2fc51824403b3"
```

## Deployment Process

### 1. Prerequisites

**Required Tools**:
```bash
# Install Wrangler CLI
npm install -g wrangler

# Authenticate with Cloudflare
wrangler auth login

# Install project dependencies
npm install
```

**Cloudflare Account Setup**:
- Cloudflare account with Workers enabled
- Domain registered (optional, can use workers.dev subdomain)
- Billing enabled for paid features (Durable Objects, R2)

### 2. Resource Creation

**Create R2 Bucket**:
```bash
# Production bucket
wrangler r2 bucket create battle-decks-slides

# Staging bucket
wrangler r2 bucket create battle-decks-slides-staging
```

**Create KV Namespaces**:
```bash
# Production namespace
wrangler kv:namespace create DECKS

# Staging namespace
wrangler kv:namespace create DECKS --env staging
```

**Update wrangler.toml**:
```toml
# Add the returned namespace IDs to wrangler.toml
[[kv_namespaces]]
binding = "DECKS"
id = "YOUR_PRODUCTION_NAMESPACE_ID"

[[env.staging.kv_namespaces]]
binding = "DECKS"
id = "YOUR_STAGING_NAMESPACE_ID"
```

### 3. Deployment Commands

**Development Deployment**:
```bash
# Local development with hot reload
wrangler dev

# Local development with remote resources
wrangler dev --remote
```

**Staging Deployment**:
```bash
# Deploy to staging environment
wrangler deploy --env staging

# View staging logs
wrangler tail --env staging
```

**Production Deployment**:
```bash
# Deploy to production
wrangler deploy

# View production logs
wrangler tail
```

## Environment Configuration

### 1. TypeScript Configuration

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020", "WebWorker"],
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**worker-configuration.d.ts** (Auto-generated):
```typescript
interface Env {
  GAME_SESSION: DurableObjectNamespace;
  SLIDES: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
}
```

### 2. Package Configuration

**package.json Scripts**:
```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:staging": "wrangler deploy --env staging",
    "types": "wrangler types",
    "tail": "wrangler tail",
    "tail:staging": "wrangler tail --env staging"
  }
}
```

## Monitoring & Observability

### 1. Logging Configuration

**Structured Logging**:
```typescript
console.log('🔌 WebSocket accepted!', {
  totalConnections: this.ctx.getWebSockets().length,
  sessionId: this.gameState?.sessionId,
  timestamp: Date.now()
});

console.error('❌ Critical error in alarm handler:', {
  error: error.message,
  stack: error.stack,
  sessionId: this.gameState?.sessionId
});
```

**Log Monitoring**:
```bash
# Real-time log streaming
wrangler tail

# Filter by log level
wrangler tail --format pretty

# Save logs to file
wrangler tail > logs.txt
```

### 2. Analytics & Metrics

**Built-in Workers Analytics**:
- Request volume and latency
- Error rates and status codes
- Geographic distribution
- CPU usage and duration

**Custom Metrics** (via console.log):
- Game session creation rate
- Average game duration
- Vote submission latency
- WebSocket connection metrics

### 3. Alerting Setup

**Cloudflare Notifications**:
- Workers error rate thresholds
- R2 storage usage alerts
- KV read/write rate monitoring
- Durable Objects CPU usage alerts

## Security Configuration

### 1. CORS Policy

```typescript
function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',           // Configure for production domain
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'            // 24-hour preflight cache
  };
}
```

### 2. Rate Limiting

**Implicit Rate Limiting**:
- Durable Objects provide natural rate limiting per session
- Workers CPU limits prevent resource exhaustion
- WebSocket connection limits per DO instance

**Explicit Rate Limiting** (Optional):
```typescript
// Example: Limit session creation per IP
const rateLimitKey = `rate_limit:${clientIP}`;
const count = await env.RATE_LIMIT_KV.get(rateLimitKey);
if (parseInt(count || '0') > 10) {
  return new Response('Rate limited', { status: 429 });
}
```

### 3. Content Security Policy

**CSP Headers** (for static assets):
```typescript
'Content-Security-Policy':
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "connect-src 'self' wss: ws:;"
```

## Performance Optimization

### 1. Caching Strategy

**R2 Asset Caching**:
```typescript
const headers = {
  'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
  'Cache-Control': 'public, max-age=86400',        // 24-hour cache
  'ETag': object.etag,                             // Enable conditional requests
  'Last-Modified': object.uploaded?.toUTCString()
};
```

**Static Asset Optimization**:
- CSS/JS minification
- Image compression and optimization
- Gzip compression for text assets
- CDN edge caching

### 2. Database Performance

**SQLite Optimization**:
```sql
-- Enable query optimization
PRAGMA optimize;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_session_id ON game_session(session_id);
CREATE INDEX IF NOT EXISTS idx_slide_id ON adjacency(slide_id);
```

**Query Patterns**:
```typescript
// Efficient prepared statements
const stmt = this.sql.prepare('SELECT * FROM game_session WHERE session_id = ?');
const result = stmt.bind(sessionId).first();

// Batch operations
this.sql.batch([
  stmt1.bind(param1),
  stmt2.bind(param2),
  stmt3.bind(param3)
]);
```

## Backup & Recovery

### 1. Data Persistence

**Durable Objects Backup**:
- SQLite data automatically replicated across Cloudflare edge
- Point-in-time recovery not available (design for stateless recovery)
- Critical data should be exportable via admin interface

**R2 Backup Strategy**:
- Slide images stored in R2 with high durability
- Cross-region replication enabled by default
- Versioning available for critical assets

### 2. Disaster Recovery

**Recovery Procedures**:
1. **Service Outage**: Cloudflare handles automatic failover
2. **Data Corruption**: Recreate from source slides and restart sessions
3. **Code Deployment Issues**: Rollback via Wrangler CLI
4. **Configuration Problems**: Restore from version control

**Recovery Commands**:
```bash
# Rollback to previous deployment
wrangler rollback

# View deployment history
wrangler deployments list

# Emergency deployment from specific commit
git checkout <commit-hash>
wrangler deploy
```

## Development Workflow

### 1. Local Development Setup

```bash
# Clone repository
git clone <repository-url>
cd battle-decks

# Install dependencies
npm install

# Generate types from wrangler.toml
wrangler types

# Start local development
npm run dev
```

### 2. Testing Strategy

**Local Testing**:
- Use `wrangler dev` for full stack testing
- Test WebSocket connections with browser dev tools
- Validate game logic with multiple browser windows

**Staging Testing**:
- Deploy to staging environment
- Full end-to-end testing with real Cloudflare resources
- Performance testing under load

**Production Validation**:
- Blue-green deployment strategy
- Gradual traffic shift
- Monitor metrics and logs during rollout

### 3. CI/CD Pipeline

**GitHub Actions Example**:
```yaml
name: Deploy Battle Decks

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## Cost Optimization

### 1. Resource Usage

**Workers Pricing**:
- 100,000 requests/day free tier
- $0.15 per additional 1M requests
- CPU time: 10ms average per request

**Durable Objects Pricing**:
- $0.12 per 1M requests
- $0.20 per GB-month storage
- Optimized for short-lived game sessions

**R2 Storage Pricing**:
- $0.015 per GB stored
- No egress fees for data transfer
- Minimal storage for slide images

**Optimization Strategies**:
- Use hibernation to minimize DO active time
- Optimize image sizes and formats
- Implement efficient caching strategies
- Monitor and alert on usage spikes