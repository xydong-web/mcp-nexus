## ADDED Requirements

### Requirement: Release preflight validation SHALL verify repository layout integrity
The system SHALL provide a preflight validation command that verifies required files and directories exist in the assembled release artifact.

#### Scenario: Assembled release is incomplete
- **WHEN** required files or folders are missing from the release artifact
- **THEN** preflight validation fails with explicit missing-item output and non-zero exit.

### Requirement: Preflight validation SHALL enforce OpenSpec spec integrity
The release workflow SHALL run strict OpenSpec validation for specs before upload.

#### Scenario: Spec validation fails
- **WHEN** `openspec validate --specs --strict` reports errors
- **THEN** upload is blocked until validation passes.

### Requirement: Preflight validation SHALL include implementation sanity checks
The release workflow SHALL define mandatory implementation sanity checks for key packages before upload.

#### Scenario: Operator executes preflight checklist
- **WHEN** preflight checks run
- **THEN** required typecheck/test/build commands are executed or explicitly acknowledged as skipped with rationale.

### Requirement: Preflight output SHALL be actionable for operators
Validation output SHALL include next steps and command suggestions to fix failing checks.

#### Scenario: Preflight check fails
- **WHEN** any validation step fails
- **THEN** output includes the failed check name and corrective command hints.
