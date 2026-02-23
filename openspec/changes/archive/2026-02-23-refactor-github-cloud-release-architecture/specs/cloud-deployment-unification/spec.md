## MODIFIED Requirements

### Requirement: Deployment guidance includes both production paths and verification
The system SHALL provide deployment documentation for Node and Worker paths, including release-assembly handoff and post-deploy verification steps.

#### Scenario: Operator follows documented deployment path
- **WHEN** an operator follows the production deployment guide for a selected runtime
- **THEN** the guide includes release artifact preparation, environment setup, migration steps, and endpoint verification checks.

#### Scenario: Operator deploys from assembled release artifact
- **WHEN** deployment begins
- **THEN** operators can identify the canonical release output directory and use it as the source for runtime deployment workflows.
