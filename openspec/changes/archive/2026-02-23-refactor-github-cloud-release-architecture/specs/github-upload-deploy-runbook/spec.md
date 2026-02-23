## ADDED Requirements

### Requirement: The system SHALL provide a single upload and deployment runbook
The project SHALL include one operator-facing runbook that defines the complete path from release assembly to GitHub upload and cloud deployment handoff.

#### Scenario: Operator needs end-to-end guidance
- **WHEN** an operator prepares to publish the project
- **THEN** the runbook provides a single ordered workflow from local assembly through deployment entry points.

### Requirement: The runbook SHALL include GitHub upload commands
The runbook SHALL include concrete Git commands for initializing a repository, setting a remote, creating a default branch, and pushing source.

#### Scenario: First-time upload to GitHub
- **WHEN** an operator follows the runbook for first publish
- **THEN** they can execute documented commands without inferring missing Git steps.

### Requirement: The runbook SHALL define cloud deployment handoff paths
The runbook SHALL include both Node/Docker and Worker deployment handoff references and required pre-deployment checks.

#### Scenario: Operator selects deployment runtime
- **WHEN** the operator chooses a deployment path
- **THEN** the runbook points to runtime-specific deployment documentation and required prerequisites.

### Requirement: The runbook SHALL define operational rollback entrypoints
The runbook SHALL specify minimal rollback actions for upload/deploy failures.

#### Scenario: Upload or deployment fails after publish
- **WHEN** rollback is required
- **THEN** the runbook provides immediate steps to disable risky features and revert to prior known-good release flow.
