## ADDED Requirements

### Requirement: Docker runtime SHALL resolve startup entrypoint deterministically
The runtime image SHALL execute the startup script through an absolute path and ensure the script is executable in the runtime layer.

#### Scenario: Platform starts container with non-default working directory
- **WHEN** the platform launches the container with a working directory other than `/app`
- **THEN** the runtime command still resolves the startup script and container boot does not fail with path lookup errors.

### Requirement: Entrypoint SHALL emit actionable startup diagnostics
The startup script SHALL log major startup phases and bootstrap policy so operators can diagnose crash loops from runtime logs alone.

#### Scenario: Container startup begins
- **WHEN** entrypoint execution starts
- **THEN** logs include the selected database bootstrap mode and whether bootstrap will run, retry, or skip.

### Requirement: Database bootstrap SHALL support policy-based failure handling
The startup script SHALL support required, best-effort, and skip bootstrap policies with configurable retries.

#### Scenario: Required mode exhausts retries
- **WHEN** `DB_BOOTSTRAP_MODE=required` and bootstrap fails for all configured retries
- **THEN** the script exits with non-zero status and logs that startup was blocked by bootstrap failure.

#### Scenario: Best-effort mode exhausts retries
- **WHEN** `DB_BOOTSTRAP_MODE=best-effort` and bootstrap fails for all configured retries
- **THEN** the script logs a warning and continues to launch the server process.

#### Scenario: Bootstrap is skipped
- **WHEN** `DB_BOOTSTRAP_MODE=skip` or `DATABASE_URL` is not set
- **THEN** the script skips `prisma db push`, logs the reason, and launches the server process.
