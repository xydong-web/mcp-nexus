## ADDED Requirements

### Requirement: Unified server settings API includes GrokSearch controls
The admin control plane SHALL provide a unified server settings API for search orchestration controls, including source routing mode, key selection strategy, and GrokSearch feature controls.

#### Scenario: Admin reads current control-plane settings
- **WHEN** an authenticated admin requests `GET /admin/api/server-info`
- **THEN** the response returns current strategy and routing values used by runtime request handling.

#### Scenario: Invalid setting update is rejected
- **WHEN** an authenticated admin submits an unsupported server setting value
- **THEN** the system rejects the update with `400` and validation guidance.

### Requirement: Admin token governance controls GrokSearch access
The admin control plane SHALL manage client tokens with per-token tool scopes and per-token rate limits that apply to GrokSearch and existing tools.

#### Scenario: Token is created with scoped tool access
- **WHEN** an authenticated admin creates a token with `allowedTools` and optional `rateLimit`
- **THEN** the system persists those constraints for MCP request enforcement.

#### Scenario: Scoped token cannot call non-allowed tool
- **WHEN** a client uses a token to call a tool outside that token's `allowedTools`
- **THEN** the MCP call is rejected with a tool-scope error.

### Requirement: Sensitive admin reveal operations are secure and auditable
The admin control plane SHALL enforce reveal security controls for sensitive secrets and token values, including rate limiting, no-store responses, and audit logging.

#### Scenario: Reveal response is non-cacheable
- **WHEN** an admin reveals a token or provider key
- **THEN** the response includes `Cache-Control: no-store`.

#### Scenario: Reveal operations are audited
- **WHEN** a reveal attempt succeeds, fails, or is rate-limited
- **THEN** the system records an audit log entry with event type, outcome, and resource reference.

### Requirement: Admin audit API supports operational investigations
The admin control plane SHALL provide paginated and filterable audit-log queries for operational analysis.

#### Scenario: Filtered audit query returns paginated results
- **WHEN** an authenticated admin queries audit logs with filters and pagination parameters
- **THEN** the system returns matching records with pagination metadata suitable for UI rendering.
