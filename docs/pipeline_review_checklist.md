# Pipeline Review Checklist

## Scope
- Current state: local Vite middleware + local filesystem assets + pipeline queue/task state.
- Goal: decide whether architecture is ready for production deployment and what remains for Vercel compatibility.

## Review A: Architecture (do now)

### 1) Task model
- [ ] All heavy endpoints support a consistent async contract (`202 + taskId + statusUrl`).
- [ ] Task state machine is explicit: `queued -> running -> success|failed|canceled`.
- [ ] Retry policy is explicit and bounded (attempt count, backoff, retryable errors).
- [ ] Idempotency strategy exists for duplicate submissions.

### 2) API contract
- [ ] `/api/pipeline/tasks` response schema is stable and documented.
- [ ] Error schema is stable (`code`, `error`, `debug`, `retryAfterSeconds` if rate limited).
- [ ] Sync and async modes have deterministic behavior and fallback rules.

### 3) Multi-tenant isolation
- [ ] User ID source is trusted/validated.
- [ ] Per-user queue limits/rate limits are enforced.
- [ ] Per-user assets/projects cannot be read or deleted cross-user.

### 4) Observability & audit
- [ ] Every task has a traceable `taskId`.
- [ ] Audit log contains: who, route, kind, enqueue/start/end, status, error summary.
- [ ] Basic metrics endpoint is available and usable for ops.

### 5) Failure recovery
- [ ] Restart behavior for `running` tasks is defined and acceptable.
- [ ] Recovery/cleanup policy for stale tasks exists.
- [ ] Queue overflow and upstream outages have user-visible, actionable errors.

## Review B: Release readiness (before go-live)

### 1) E2E flows
- [ ] Create project -> generate image/video -> view output.
- [ ] Delete project -> local/remote assets cleanup -> no orphan tasks.
- [ ] Import/export project across users works and ownership metadata is preserved.

### 2) Load and stability
- [ ] Concurrency and rate-limit pressure test results documented.
- [ ] Retry storms are controlled (no unbounded amplification).
- [ ] Long tasks do not block unrelated API requests.

### 3) Security
- [ ] API key usage and secrets storage reviewed.
- [ ] Path traversal and arbitrary file read/write protections tested.
- [ ] Input size limits and payload validation enforced on task submission.

### 4) Rollout & rollback
- [ ] Feature flags for async mode.
- [ ] Rollback path to previous sync behavior.
- [ ] Operational runbook (common errors + mitigation).

## Vercel Deployment Readiness

## Short answer
- Not yet. Completing current checklist does **not** automatically mean production-ready Vercel deployment.

## Current blockers for Vercel
- Vite middleware is being used as a long-running backend (not ideal for serverless runtime constraints).
- Filesystem dependencies (`.vision-assets`, `.vision-pipeline`, `.vision-audit`) are local-state oriented; serverless filesystem is ephemeral.
- Long video/image generation and polling loops exceed typical serverless request patterns.
- In-memory queue/worker model does not survive scale-out across multiple instances.

## Required migration path
- Extract backend endpoints from Vite middleware to dedicated API service layer.
- Replace local file persistence with object storage (e.g. S3/R2/Vercel Blob).
- Replace in-process queue with managed queue + worker (e.g. Upstash QStash, Redis queue, or dedicated worker service).
- Move task/audit state to database (Postgres/Redis), not local JSON files.
- Add signed URL strategy for asset read/write and strict tenant authorization.

## Suggested next implementation steps
1. Frontend: switch video generation to async submit + polling task status.
2. Backend: add explicit cancel endpoint and stable task schema version.
3. Infra abstraction: introduce `TaskStore` and `AssetStore` interfaces (local impl now, cloud impl next).
4. Then migrate deployment target from Vite middleware to standalone API/worker.
