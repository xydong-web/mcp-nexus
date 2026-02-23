## 1. Release assembly tooling

- [x] 1.1 Add a root release assembly script that copies canonical source repo into `release/mcp-nexus` with deterministic exclusion rules.
- [x] 1.2 Overlay authoritative root `openspec/` content into assembled release output.
- [x] 1.3 Emit a machine-readable release manifest (timestamp + source paths) in assembled output.

## 2. Upload hygiene and validation

- [x] 2.1 Expand root `.gitignore` to exclude caches, snapshots, generated release folders, and temporary artifacts.
- [x] 2.2 Add a release preflight validator script that checks required directories/files in assembled output.
- [x] 2.3 Ensure preflight validator fails with actionable diagnostics and non-zero exit when checks fail.

## 3. Operator documentation

- [x] 3.1 Add a GitHub upload and cloud deployment handoff runbook in workspace root.
- [x] 3.2 Document exact commands for release assembly, preflight checks, Git init/remote/push, and deployment entrypoints.
- [x] 3.3 Include rollback and failure-handling guidance in the runbook.

## 4. Verification and spec hygiene

- [x] 4.1 Run OpenSpec strict validation for the new change and fix any formatting/spec issues.
- [x] 4.2 Execute release assembly + preflight scripts and confirm expected success paths.
- [x] 4.3 Mark all completed tasks and ensure the change is ready for apply/archive flow.
