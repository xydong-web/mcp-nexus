## 1. Schema and storage foundation

- [x] 1.1 Extend `packages/db/prisma/schema.prisma` with Grok token and Grok usage models (status, cooldown, encrypted secret, masked value, telemetry fields) and generate migration files.
- [x] 1.2 Add equivalent Worker D1 migration updates in `packages/worker/migrations` for Grok token lifecycle columns and Grok tool usage table/indexes.
- [x] 1.3 Update DB access layers (`packages/bridge-server` Prisma services and `packages/worker/src/db/d1.ts`) to read/write new Grok token and usage entities.

## 2. Node bridge Grok token pool and provider integration

- [x] 2.1 Implement Grok key pool service in `packages/bridge-server/src` mirroring Tavily pool semantics (round-robin/random selection, preflight eligibility, cooldown, invalidation, recovery hooks).
- [x] 2.2 Add Grok upstream client/provider wiring with deterministic error mapping (`401/403` -> invalid, `429` -> cooldown, retry guidance propagation).
- [x] 2.3 Record Grok runtime usage telemetry (tool, outcome, token reference, latency, error summary) on every Grok-backed tool execution.

## 3. MCP tool surface and gateway enforcement

- [x] 3.1 Register `web_search`, `get_sources`, `web_fetch`, and `web_map` in the combined MCP tool registry and expose them via `/mcp` `tools/list` and `tools/call`.
- [x] 3.2 Enforce existing gateway controls for Grok tools (bearer auth, global/per-token rate limits, `allowedTools` scope checks) in the same path as current tools.
- [x] 3.3 Implement `web_search` enrichment orchestration with configured supplementary providers and graceful degradation metadata when enrichment fails.
- [x] 3.4 Implement `combined` supplemental routing merge logic with canonical URL deduplication before response limits are applied.

## 4. Unified admin control plane (API + settings)

- [x] 4.1 Extend server settings contract in `packages/bridge-server/src/settings/serverSettings.ts` and admin APIs to include Grok controls (`grokSearchEnabled`, model defaults, source/enrichment strategy, Grok key selection strategy).
- [x] 4.2 Add admin endpoints in `packages/bridge-server/src/admin/routes.ts` for Grok token CRUD, secure reveal (`Cache-Control: no-store`), lifecycle actions, and validation errors.
- [x] 4.3 Ensure all sensitive Grok admin operations (create/update/delete/reveal/rate-limited reveal) emit audit log events with outcome and resource reference.
- [x] 4.4 Update `GET /admin/api/server-info` and related handlers so invalid setting values return `400` with actionable validation guidance.

## 5. Worker runtime parity and rollout controls

- [x] 5.1 Extend `packages/worker/src/mcp/mcpHandler.ts` and related services to expose GrokSearch tools with consistent `/mcp` auth, tool-scope, and rate-limit semantics.
- [x] 5.2 Implement Worker-side Grok token selection and lifecycle transitions compatible with Node behavior for invalid/cooldown states.
- [x] 5.3 Align Worker endpoint and error behavior for `/health`, `/mcp`, and `/admin/api` with Node runtime expectations for this change.
- [x] 5.4 Add feature-flagged rollout controls so Grok integration can be disabled quickly without impacting existing Tavily/Brave tools.

## 6. Admin UI updates for Grok operations

- [x] 6.1 Add Grok settings and token management APIs in `packages/admin-ui/src/lib/adminApi.ts`.
- [x] 6.2 Update admin pages/components to manage Grok tokens, selection strategy, and GrokSearch feature toggles with clear validation feedback.
- [x] 6.3 Add secure reveal UX for Grok secrets consistent with existing reveal safeguards and audit expectations.

## 7. Deployment docs, testing, and verification

- [x] 7.1 Update deployment and operations docs (including Node/Docker and Worker paths) with Grok-related environment variables, migration steps, verification checks, and rollback procedure.
- [x] 7.2 Add/extend automated tests for Grok token lifecycle transitions, MCP tool exposure/invocation, scope enforcement, enrichment degradation, and audit logging.
- [x] 7.3 Run workspace validation commands (`typecheck`/tests/build as applicable) and fix regressions introduced by this change.
- [x] 7.4 Run `openspec validate integrate-mcp-nexus-groksearch --strict` and ensure the change remains apply-ready.
