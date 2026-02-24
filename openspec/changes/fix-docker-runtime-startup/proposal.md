## Why

Recent Zeabur deployments build successfully but fail at runtime with `CRASHED` or `SUSPENDED` status. Startup is currently brittle and hard to diagnose because container boot depends on a single shell command path and a fail-fast database bootstrap step.

## What Changes

- Harden Docker runtime startup by invoking an absolute entrypoint path and ensuring executable permissions in the runtime image.
- Improve `docker/entrypoint.sh` with clear startup logs and explicit bootstrap mode reporting.
- Add configurable database bootstrap behavior with retry support and policy-based failure handling.
- Update deployment troubleshooting guidance for cloud environments where build succeeds but runtime crashes.

## Capabilities

### New Capabilities
- `docker-startup-resilience`: Make container startup deterministic, diagnosable, and resilient for managed cloud platforms.

### Modified Capabilities
- None.

## Impact

- Affected code: `Dockerfile`, `docker/entrypoint.sh`.
- Affected docs: `DEPLOYMENT.md`.
- Operational impact: fewer runtime crash loops and faster root-cause identification during cloud deploys.
