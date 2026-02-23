# release-repository-assembly Specification

## Purpose
TBD - created by archiving change refactor-github-cloud-release-architecture. Update Purpose after archive.
## Requirements
### Requirement: Release repository assembly SHALL produce a deterministic output directory
The system SHALL provide a release assembly command that generates a clean repository artifact in a deterministic target directory.

#### Scenario: Operator assembles release artifact
- **WHEN** an operator runs the release assembly command from workspace root
- **THEN** the command creates the configured release output directory with the canonical codebase content.

#### Scenario: Required source paths are missing
- **WHEN** canonical source directories are missing or unreadable
- **THEN** the command fails fast with actionable path diagnostics and a non-zero exit status.

### Requirement: Release assembly SHALL enforce upload hygiene exclusions
The release artifact SHALL exclude local caches, tool state, and binary snapshot files that are not required for source control.

#### Scenario: Workspace contains local and generated artifacts
- **WHEN** release assembly copies files into the output directory
- **THEN** excluded patterns (including `node_modules`, local tool folders, and `*.zip`) are not present in the output.

### Requirement: Release assembly SHALL include authoritative OpenSpec content
The release artifact SHALL include OpenSpec specs and archived changes aligned with the implementation intended for upload.

#### Scenario: OpenSpec is split from code source location
- **WHEN** release assembly runs
- **THEN** the output repository contains the authoritative `openspec/` tree required for architecture traceability.

### Requirement: Release assembly SHALL emit an auditable manifest
The system SHALL emit a machine-readable manifest describing release source paths and generation timestamp.

#### Scenario: Release output is generated
- **WHEN** assembly succeeds
- **THEN** a manifest file exists in the output directory with source path metadata and generated-at timestamp.

