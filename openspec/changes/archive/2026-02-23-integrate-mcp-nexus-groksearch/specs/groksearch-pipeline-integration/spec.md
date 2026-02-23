## ADDED Requirements

### Requirement: Unified MCP exposure for GrokSearch tools
The system SHALL expose `web_search`, `get_sources`, `web_fetch`, and `web_map` through the same `/mcp` JSON-RPC surface used by existing tools.

#### Scenario: Tools list includes GrokSearch tools
- **WHEN** a client calls `tools/list` on `/mcp`
- **THEN** the response includes the GrokSearch tool definitions available to that server configuration.

#### Scenario: Tools can be invoked through JSON-RPC
- **WHEN** a client invokes one of the GrokSearch tools via `tools/call`
- **THEN** the system executes the mapped pipeline and returns MCP-compatible tool content.

### Requirement: Existing gateway controls apply to GrokSearch calls
The system SHALL apply the existing MCP gateway controls to GrokSearch tools, including bearer-token authentication, global/per-token rate limits, and per-token `allowedTools` constraints.

#### Scenario: Missing token is rejected
- **WHEN** a client calls `/mcp` without `Authorization: Bearer <token>`
- **THEN** the system rejects the request with `401`.

#### Scenario: Disallowed tool is blocked by token scope
- **WHEN** a token-scoped client invokes a GrokSearch tool that is not in the token's `allowedTools`
- **THEN** the system rejects the call with a tool-not-allowed error.

### Requirement: Web search pipeline supports source enrichment and graceful degradation
The system SHALL execute Grok as the primary search engine for `web_search` and SHALL support supplementary source enrichment with configured providers.

#### Scenario: Enrichment succeeds
- **WHEN** a `web_search` call is executed with supplementary providers enabled
- **THEN** the system returns Grok-driven results enriched by supplementary sources in a single tool response.

#### Scenario: Supplementary provider fails
- **WHEN** supplementary source retrieval fails but primary Grok retrieval succeeds
- **THEN** the system returns a successful response containing primary results
- **AND** the system indicates degraded enrichment state in response metadata or structured message.

### Requirement: Supplemental source routing honors server source mode
The system SHALL honor configured source routing mode for supplementary provider calls.

#### Scenario: Combined mode merges and deduplicates provider results
- **WHEN** source mode is `combined`
- **THEN** the system invokes both configured supplementary providers when available
- **AND** merged results MUST be deduplicated by canonical URL before applying output limits.
