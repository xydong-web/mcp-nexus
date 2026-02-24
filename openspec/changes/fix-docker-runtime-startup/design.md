## Context

The image currently starts with `CMD ["sh", "docker/entrypoint.sh"]`, and the entrypoint immediately runs `prisma db push` with strict failure behavior. On managed platforms, this can lead to crash loops when runtime conditions differ from local assumptions (for example, startup path resolution differences or transient database unavailability). Logs are also too thin to quickly isolate startup failures.

## Goals / Non-Goals

**Goals:**
- Ensure startup script resolution is deterministic in runtime containers.
- Make entrypoint behavior explicit and observable through clear logs.
- Add policy-based database bootstrap behavior (`required`, `best-effort`, `skip`) with retries.
- Preserve current default safety: fail startup if bootstrap fails in required mode.

**Non-Goals:**
- Replace Prisma bootstrap with a separate migration framework.
- Redesign application runtime configuration validation.
- Remove database bootstrap capability from container startup.

## Decisions

1. **Use an absolute entrypoint path in Docker runtime**
   - Set runtime command to `/app/docker/entrypoint.sh`.
   - Ensure script executable permission (`chmod +x`) in the runtime stage.
   - Alternative considered: keep relative `sh docker/entrypoint.sh`; rejected due to weaker path determinism.

2. **Keep shell-based startup orchestration**
   - Continue using a dedicated shell script for bootstrap + launch orchestration.
   - Alternative considered: inline Docker CMD chain; rejected for readability and debuggability.

3. **Introduce explicit bootstrap policy controls**
   - Add `DB_BOOTSTRAP_MODE` with values: `required` (default), `best-effort`, `skip`.
   - Add `DB_BOOTSTRAP_RETRIES` and `DB_BOOTSTRAP_RETRY_DELAY_SECONDS` for retry behavior.
   - Skip bootstrap automatically when `DATABASE_URL` is missing, with log output.

## Risks / Trade-offs

- **[Risk] Operators use `best-effort` and miss schema drift** -> Mitigation: default mode remains `required`; docs clarify trade-offs.
- **[Risk] Extra startup retries delay readiness during real outages** -> Mitigation: retry count and delay are configurable.
- **[Risk] Additional script logic introduces edge cases** -> Mitigation: keep logic small, deterministic, and logged.

## Migration Plan

1. Deploy new image with hardened Docker CMD and updated entrypoint behavior.
2. Keep default `DB_BOOTSTRAP_MODE=required` for existing environments.
3. For transient cloud startup issues, set `DB_BOOTSTRAP_MODE=best-effort` temporarily.
4. Roll back by deploying the previous image tag if behavior regresses.

## Open Questions

- Should future releases move schema migration to a dedicated pre-deploy job for production-grade environments?
