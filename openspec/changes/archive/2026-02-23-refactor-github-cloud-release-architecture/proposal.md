## Why

The current workspace mixes source code, archived OpenSpec artifacts, downloaded ZIP snapshots, and duplicate project directories. This makes GitHub uploads error-prone and creates deployment drift between what is tested locally and what is pushed.

## What Changes

- Define a canonical release assembly flow that produces a clean, upload-ready repository from the current workspace.
- Add deterministic exclusions (archives, caches, local tooling folders, build residue) so Git pushes stay small and reproducible.
- Align OpenSpec specs used for delivery with the assembled repository so architecture docs and code ship together.
- Add an operator runbook for GitHub upload and cloud server deployment from the assembled release.
- Add preflight validation commands for release structure and deployment readiness.

## Capabilities

### New Capabilities
- `release-repository-assembly`: Assemble a clean GitHub-ready repo from the current workspace with deterministic include/exclude rules.
- `github-upload-deploy-runbook`: Provide a single runbook for upload, branch protection basics, and cloud deployment handoff.
- `release-preflight-validation`: Validate release structure and critical deployment prerequisites before upload.

### Modified Capabilities
- `cloud-deployment-unification`: Extend deployment guidance to include release-assembly handoff expectations before runtime deployment.

## Impact

- Affected code:
  - Workspace root scripts and documentation for release assembly and preflight checks
  - Root `.gitignore` and release hygiene rules
  - OpenSpec specs under `openspec/specs/`
- Affected operations:
  - GitHub upload workflow (init/remote/push from release output)
  - Cloud deployment workflow now starts from a deterministic release artifact
- Risk:
  - Low runtime risk (tooling/docs focused), moderate workflow impact if operators skip new preflight checks
