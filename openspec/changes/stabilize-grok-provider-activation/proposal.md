## Why

Operators can save a Grok provider API key in the Admin UI but still observe no Grok tool effect in clients. The current UX separates Grok enablement from provider save, and runtime setting cache can delay cross-instance consistency, making activation feel unreliable.

## What Changes

- Improve Grok enablement UX with an explicit action button that applies immediately.
- When saving Grok provider key from UI, auto-enable Grok tools if currently disabled.
- Refresh server state after provider updates so UI reflects persisted runtime state.
- Reduce Grok-related settings cache staleness window to improve activation consistency across instances.

## Capabilities

### New Capabilities
- `grok-activation-consistency`: Ensure Grok provider/key operations quickly and clearly activate Grok runtime behavior.

### Modified Capabilities
- None.

## Impact

- Affected code: `packages/admin-ui/src/pages/SettingsPage.tsx`, `packages/bridge-server/src/settings/serverSettings.ts`.
- User impact: clearer enable flow, fewer “saved but no reaction” outcomes, faster settings propagation.
