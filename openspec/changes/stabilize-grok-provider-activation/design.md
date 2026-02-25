## Context

Grok availability depends on both feature enablement (`grokSearchEnabled`) and credential readiness (provider key or active Grok pool keys). Existing UI requires a separate save for Grok settings and provider settings, while runtime settings are cached, which can delay visible activation in distributed deployments.

## Goals / Non-Goals

**Goals:**
- Make Grok enablement explicit and immediately applied.
- Ensure saving provider credentials can activate Grok in the common “provider-only” setup.
- Reduce confusing lag between admin changes and MCP runtime behavior.

**Non-Goals:**
- Redesign all settings page sections.
- Remove Grok key pool support.
- Change Grok API call semantics.

## Decisions

1. Replace passive Grok enable checkbox interaction with explicit action button behavior in settings section.
2. After saving provider config, if Grok is disabled, issue a follow-up server-info update to enable Grok.
3. Refresh `serverInfo` after provider save for strong UI/runtime alignment.
4. Clamp Grok settings cache lifetime to a short maximum window to reduce stale reads.

## Risks / Trade-offs

- **[Risk] Auto-enable surprises operators who only wanted to stage credentials** -> Mitigation: only auto-enable when a provider API key is actively submitted.
- **[Risk] More frequent reads for Grok settings increase DB queries** -> Mitigation: keep a short cache, not fully uncached.
- **[Risk] Additional API call on provider save can fail independently** -> Mitigation: report clear toast and keep provider save successful.
