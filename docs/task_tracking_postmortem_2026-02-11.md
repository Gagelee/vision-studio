# Task Tracking Postmortem (2026-02-11)

## Incident summary

Repeated user-facing symptom:
- backend task already completed
- UI still shows `queued/running`
- retries can create more state divergence (`status mismatch`, `asset mismatch`, `lost task linkage`)

Primary concrete fault found:
- `/api/pipeline/tasks/:id` could return HTML fallback instead of JSON due to route path handling mismatch under mounted middleware.

## Why this kept recurring

1. We over-trusted local state transitions.
- UI state updates (`queued`, `running`, `error`) were treated as source-of-truth.
- Backend reconcile path was not treated as a hard dependency in diagnostics.

2. We had weak observability at the exact seam that matters.
- No default assertion that status endpoint payload shape is JSON task schema.
- No mandatory timeline output showing `submit -> accepted -> poll -> terminal`.

3. Error paths cleared critical linkage too aggressively.
- In transient failures, `taskId/statusUrl` could be dropped from front-end state.
- After linkage loss, later backend success could no longer map to asset node.

4. Mock strategy was initially incomplete.
- Early mock attempts bypassed async path, hiding queue/poll timing issues.
- This produced false confidence while real async behavior still failed.

## Final method that worked

Use mock only for model responses, not for orchestration:
- keep real async pipeline (`202 accepted`, queued/running/success)
- keep real polling and reconcile logic
- replace expensive provider response with `mock-sim-*`
- trace transitions from API submit to terminal task record

## Guardrails added

1. Fix status route resolution so `/api/pipeline/tasks/:id` always returns JSON task payload.
2. Preserve task linkage on recoverable error paths when `taskId/statusUrl` exists.
3. Increase reconcile cadence to reduce stale queued/running perception.
4. Add heavy debug harness (`scripts/debug-iteration.mjs`) for realistic mock interaction tests.

## Process change

For major pipeline refactors and hard-to-locate state bugs:
- run `debug:iteration` before release
- require pass on status-shape + async-transition assertions
- treat this as a release gate for task-tracking changes
