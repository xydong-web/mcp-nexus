## ADDED Requirements

### Requirement: Provider key save SHALL produce actionable Grok activation behavior
When a provider API key is saved from the admin settings flow, the system SHALL avoid a silent “configured but inactive” state.

#### Scenario: Provider key saved while Grok is disabled
- **WHEN** an operator saves a non-empty Grok provider API key and GrokSearch is currently disabled
- **THEN** the UI performs an activation update so Grok tools become enabled without requiring a separate hidden step.

### Requirement: Grok enable controls SHALL be explicit
Admin UI SHALL present a clear Grok enable/disable action control instead of a low-visibility passive control.

#### Scenario: Operator needs to enable Grok tools
- **WHEN** GrokSearch is disabled
- **THEN** the settings panel shows a clear enable action and applies it to server settings.

### Requirement: Grok runtime settings propagation SHALL avoid long stale windows
Runtime reads for Grok enable/provider state SHALL use a short cache window so recent admin updates become effective quickly.

#### Scenario: Admin updates Grok settings in one request path
- **WHEN** a subsequent MCP request is handled shortly after the update
- **THEN** runtime Grok settings reflect the updated state within a short bounded delay.
