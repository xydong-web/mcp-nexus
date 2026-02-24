## 1. Startup hardening

- [x] 1.1 Update the Docker runtime command to use an absolute entrypoint path and ensure executable permissions are set in the runtime image.
- [x] 1.2 Refactor `docker/entrypoint.sh` to add structured startup logs and explicit bootstrap mode parsing.
- [x] 1.3 Add retry-aware Prisma bootstrap execution with `required`, `best-effort`, and `skip` behavior.

## 2. Deployment guidance

- [x] 2.1 Document bootstrap mode and retry environment variables in deployment documentation.
- [x] 2.2 Add troubleshooting guidance for runtime crash loops caused by startup bootstrap failures.
