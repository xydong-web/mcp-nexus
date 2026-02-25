## Why

The settings page currently warns that no Grok keys are active whenever GrokSearch is enabled and the Grok key pool is empty. This warning is misleading when operators intentionally use the Grok provider connection (base URL + API key) instead of stored Grok key records.

## What Changes

- Refine Grok warning visibility logic in Admin UI settings.
- Show the warning only when GrokSearch is enabled, no active Grok keys exist, and Grok provider API key is not configured.
- Keep existing provider settings UX unchanged.

## Capabilities

### New Capabilities
- `admin-grok-warning-accuracy`: Ensure Grok warning messaging matches actual runtime eligibility sources.

### Modified Capabilities
- None.

## Impact

- Affected code: `packages/admin-ui/src/pages/SettingsPage.tsx`.
- User impact: avoids false warning when provider API key is configured via UI/env/database.
