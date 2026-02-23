# Cloudflare Deployment Guide

This guide covers deploying MCP Nexus to Cloudflare's free tier.

## Prerequisites

- Cloudflare account (free tier works)
- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)

## Architecture

The deployment uses:
- **Cloudflare Workers** - Main API and MCP server
- **Cloudflare D1** - SQLite database (included on Workers Free; limits apply)
- **Cloudflare Durable Objects (SQLite-backed)** - Session management + rate limiting (included on Workers Free; limits apply)
- **Workers static assets** - Admin UI and landing page are served from the Worker (no Pages required)

## Deployment Steps

### 1. Login to Cloudflare

```bash
wrangler login
```

### 2. Create D1 Database

```bash
cd packages/worker
wrangler d1 create mcp-nexus-db
```

Copy the database_id from the output and update `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "mcp-nexus-db",
    "database_id": "YOUR_DATABASE_ID_HERE"
  }
]
```

### 3. Run Database Migrations

```bash
# Apply all unapplied migrations to the remote D1 database
# (This will prompt for confirmation in an interactive shell.)
wrangler d1 migrations apply DB --remote
```

This ensures the schema includes:
- scoped client tokens (allowed tool list)
- per-token rate limiting overrides
- Grok key lifecycle tables (`GrokKey`) and usage telemetry (`GrokToolUsage`)

### 4. Set Secrets

```bash
# Admin API token (generate a secure random string)
wrangler secret put ADMIN_API_TOKEN

# Encryption key for API keys (base64-encoded 32-byte key)
# Generate: openssl rand -base64 32
wrangler secret put KEY_ENCRYPTION_SECRET
```

### 5. Deploy Worker

```bash
wrangler deploy
```

The worker will be available at: `https://mcp-nexus.<your-subdomain>.workers.dev`

### 6. (Optional) Host Admin UI on a different origin

Not required. By default the Worker serves the Admin UI from `packages/worker/public/` using Wrangler `assets`.
If you *choose* to host the Admin UI elsewhere, you can point `ADMIN_UI_URL` at that external origin (used for CORS/origin allowlisting).

## Configuration

### Environment Variables

Set in `wrangler.jsonc` or via `wrangler vars put`:

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_RATE_LIMIT_PER_MINUTE` | Per-client rate limit | 60 |
| `MCP_GLOBAL_RATE_LIMIT_PER_MINUTE` | Global rate limit | 600 |
| `TAVILY_KEY_SELECTION_STRATEGY` | Key selection: round_robin, random | round_robin |
| `ADMIN_UI_URL` | URL to Admin UI (if hosted separately) | - |
| `GROK_SEARCH_ENABLED` | Enable/disable Grok tools (`web_search`, `get_sources`, `web_fetch`, `web_map`) | false |
| `GROK_MODEL_DEFAULT` | Default Grok model for `web_search` | grok-4-latest |
| `GROK_EXTRA_SOURCES_DEFAULT` | Default supplemental source count for Grok `web_search` | 0 |
| `GROK_SEARCH_SOURCE_MODE` | Grok supplemental source mode | combined |
| `GROK_KEY_SELECTION_STRATEGY` | Grok key selection strategy (`round_robin`, `random`) | round_robin |
| `GROK_TIMEOUT_MS` | Grok request timeout (ms) | 20000 |
| `GROK_USAGE_LOG_MODE` | Grok usage logging mode (`none`, `hash`, `preview`, `full`) | preview |
| `GROK_USAGE_SAMPLE_RATE` | Optional Grok usage sampling ratio (0-1) | - |
| `FIRECRAWL_API_URL` | Optional Firecrawl base URL override | https://api.firecrawl.dev/v1 |

### Secrets (via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `ADMIN_API_TOKEN` | Token for admin API access |
| `KEY_ENCRYPTION_SECRET` | Base64 key for encrypting API keys |
| `FIRECRAWL_API_KEY` | Optional Firecrawl API key used by Grok fallback flows |
| `GROK_USAGE_HASH_SECRET` | Optional HMAC secret for Grok query hashing |

## Usage

### Add API Keys via Admin API

```bash
# Add a Tavily key
curl -X POST https://your-worker.workers.dev/admin/api/tavily-keys \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "My Tavily Key", "key": "tvly-xxx..."}'

# Add a Brave key
curl -X POST https://your-worker.workers.dev/admin/api/brave-keys \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "My Brave Key", "key": "BSA-xxx..."}'

# Add a Grok key
curl -X POST https://your-worker.workers.dev/admin/api/grok-keys \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "My Grok Key", "key": "xai-xxx..."}'

# Enable Grok tools and defaults
curl -X PATCH https://your-worker.workers.dev/admin/api/server-info \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "grokSearchEnabled": true,
    "grokModelDefault": "grok-4-latest",
    "grokExtraSourcesDefault": 4,
    "grokSearchSourceMode": "combined",
    "grokKeySelectionStrategy": "round_robin"
  }'
```

### Create Client Token

```bash
curl -X POST https://your-worker.workers.dev/admin/api/tokens \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "My MCP Client"}'
```

Save the returned token securely. Admins can re-reveal newly created tokens later via `GET /admin/api/tokens/:id/reveal`.

### Configure MCP Client

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "mcp-nexus": {
      "url": "https://your-worker.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_CLIENT_TOKEN"
      }
    }
  }
}
```

## Free Tier Limits

Cloudflare’s Workers Free plan includes usage limits (requests, CPU time, D1 reads/writes/storage, Durable Objects, etc.) that can change over time.

**$0 hosting expectation (Cloudflare):** On the Free plan, Cloudflare does not bill overages—when you hit included limits, requests may be throttled or start failing until limits reset (or you upgrade).

Check the current official limits here:

```text
Workers limits: https://developers.cloudflare.com/workers/platform/limits/
D1 limits:      https://developers.cloudflare.com/d1/platform/limits/
DO limits:      https://developers.cloudflare.com/durable-objects/platform/limits/
```

## Local Development

```bash
cd packages/worker

# Create local D1 database
wrangler d1 migrations apply DB --local

# Start dev server
npm run dev
```

## Troubleshooting

### "No API keys configured"
Add Tavily or Brave API keys via the admin API.

### "Authorization header required"
Include the client token in the Authorization header.

### "Token has been revoked"
Generate a new client token.

### D1 errors
Check that the database_id in wrangler.jsonc matches your D1 database.

## Rollback (Grok feature only)

If Grok upstream becomes unstable, disable Grok tools without affecting Tavily/Brave:

```bash
curl -X PATCH https://your-worker.workers.dev/admin/api/server-info \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"grokSearchEnabled": false}'
```

You can also remove Grok tool access from selected client tokens by updating their `allowedTools` list.
