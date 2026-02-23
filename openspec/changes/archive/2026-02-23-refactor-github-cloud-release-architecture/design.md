## Context

The workspace currently contains:

- Primary implementation repository at `mcp-nexus-main/mcp-nexus-main/`
- Archived/downloaded snapshots (`*.zip`, extracted folders)
- OpenSpec specs and archived changes at the workspace root (`openspec/`)

This split causes upload risk: operators may push the wrong directory, include large temporary files, or ship code without the correct OpenSpec specs and deployment runbook.

## Goals / Non-Goals

**Goals:**

- Produce a deterministic, clean repository artifact for GitHub upload.
- Ensure the artifact includes the correct codebase and authoritative OpenSpec specs.
- Provide an explicit operator runbook for GitHub upload and cloud deployment handoff.
- Add fast preflight checks before upload/deploy.

**Non-Goals:**

- Refactoring runtime business logic in bridge-server/worker.
- Replacing existing Docker/Cloudflare deployment implementations.
- Changing API behavior of MCP/admin endpoints.

## Decisions

### 1) Release artifact is assembled, not manually curated

- Add a root-level Node script that creates `release/mcp-nexus/` from known sources.
- The script copies the canonical code repo (`mcp-nexus-main/mcp-nexus-main`) and then overlays root OpenSpec (`openspec/`) so code and specs stay aligned.

**Why:** removes operator ambiguity and avoids manual file selection errors.

**Alternatives considered:**
- Manual copy/upload: too error-prone.
- Full workspace git init: risks committing snapshots and irrelevant folders.

### 2) Use explicit exclusion rules for upload hygiene

- Exclude `node_modules`, local tool state folders, temporary release outputs, and ZIP snapshots.
- Strengthen root `.gitignore` to prevent accidental large-file commits.

**Why:** reduce repository size and upload failures; keep history clean.

### 3) Add a single runbook for upload + cloud deployment handoff

- Add one concise guide that covers:
  - release assembly
  - GitHub init/remote/push
  - required checks before deployment
  - Node/Docker and Worker deployment entry points

**Why:** deployment failures are often procedural, not code-related.

### 4) Add preflight validation gates before upload

- Validate release layout (required files/folders exist).
- Validate OpenSpec spec integrity (`openspec validate --specs --strict`).
- Reuse existing package-level build/test/typecheck commands as operator checkpoints.

**Why:** catch structural issues early with deterministic checks.

## Risks / Trade-offs

- [Risk] Release assembly script path assumptions break if workspace layout changes → Mitigation: centralize paths in constants and fail with actionable errors.
- [Risk] Operators skip preflight checks and push incomplete artifacts → Mitigation: runbook includes mandatory checklist and exact commands.
- [Risk] Overlaying root OpenSpec into release repo may hide repo-local OpenSpec state → Mitigation: make this behavior explicit and document rationale.

## Migration Plan

1. Add release assembly script and release-layout verifier.
2. Update root `.gitignore` for repository hygiene.
3. Add upload/deploy runbook referencing exact commands.
4. Execute preflight validation and OpenSpec strict validation.
5. Use assembled `release/mcp-nexus/` directory as the only GitHub upload source.

Rollback:
- If assembly flow is rejected, continue using current manual process.
- Remove new scripts/docs and revert `.gitignore` changes.

## Open Questions

- Should future automation create/push GitHub tags/releases automatically, or remain manual?
- Should release assembly support optional pruning of docs/examples for minimal production mirrors?
