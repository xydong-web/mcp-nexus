## Context

Grok runtime supports two credential paths: Grok key pool records and provider API key configuration. The Settings page warning currently only checks active Grok key count, causing false positives when provider credentials are configured.

## Goals / Non-Goals

**Goals:**
- Align warning condition with runtime reality.
- Keep UI behavior minimal and backward compatible.
- Avoid introducing new API fields or server-side changes.

**Non-Goals:**
- Redesign Grok settings layout.
- Change Grok tool execution logic.
- Add new admin endpoints.

## Decisions

1. Reuse existing provider-configured state already loaded by Settings page (`grokProviderApiKeyConfigured`).
2. Gate warning on three conditions:
   - GrokSearch enabled.
   - No active Grok key records.
   - Provider API key not configured.
3. Keep warning text unchanged to minimize localization and copy changes.

## Risks / Trade-offs

- **[Risk] Temporary stale provider state during initial load** -> Mitigation: state is initialized from `server-info` and then refreshed from `/admin/api/grok-provider`.
- **[Risk] Operators misunderstand source precedence** -> Mitigation: provider section already displays configured badge and masked key.
