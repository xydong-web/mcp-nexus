## ADDED Requirements

### Requirement: Node and Worker runtimes expose consistent service entrypoints
The deployment model SHALL provide consistent core entrypoints for Node and Cloudflare Worker runtimes.

#### Scenario: Runtime exposes required endpoints
- **WHEN** either runtime is deployed
- **THEN** it exposes `/health`, `/mcp`, and admin API routes under `/admin/api`.

#### Scenario: MCP endpoint enforces client authentication
- **WHEN** a request is sent to `/mcp` without a valid client bearer token
- **THEN** both runtimes reject the request with an authorization error.

### Requirement: Cross-runtime configuration semantics are unified
The deployment model SHALL define shared configuration semantics for authentication, encryption, routing, and rate limiting across runtimes.

#### Scenario: Shared source-mode configuration produces consistent routing
- **WHEN** equivalent source-mode configuration is applied in both runtimes
- **THEN** both runtimes apply the same provider-routing behavior for search-source tools.

#### Scenario: Shared token rate-limit configuration produces consistent throttling
- **WHEN** equivalent global and per-token rate-limit settings are applied in both runtimes
- **THEN** both runtimes enforce throttling with equivalent rate-limit outcomes.

### Requirement: Deployment guidance includes both production paths and verification
The system SHALL provide deployment documentation for Node and Worker paths, including post-deploy verification steps.

#### Scenario: Operator follows documented deployment path
- **WHEN** an operator follows the production deployment guide for a selected runtime
- **THEN** the guide includes environment setup, migration steps, and endpoint verification checks.

### Requirement: Rollout supports gradual enablement and rollback
The deployment model SHALL support staged rollout and rollback for GrokSearch integration without breaking existing Tavily/Brave operations.

#### Scenario: Feature is disabled during rollback
- **WHEN** operators disable GrokSearch integration during rollback
- **THEN** existing non-Grok tools remain available through `/mcp` under existing token governance and rate-limit controls.
