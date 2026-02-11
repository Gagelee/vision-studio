# Debug Iteration (Heavy Integration Harness)

## Why this exists

Unit/integration tests do not fully cover asynchronous UI + pipeline state drift.

Use this harness when:
- you run a major refactor touching task tracking/pipeline/state sync
- you hit bugs like "asset already generated but UI still queued/running"
- a bug cannot be reproduced by existing unit tests

Do **not** run this on every small change.

## Root lessons from recent incidents

1. Status endpoint availability is part of the state machine.
If `/api/pipeline/tasks/:id` degrades to HTML/fallback route, front-end reconcile silently dies.

2. Error handling must preserve task linkage when possible.
If `taskId/statusUrl` are dropped on transient failure, later backend success becomes unreachable from UI state.

3. "Queued forever" is often a synchronization failure, not generation failure.
The backend may already be `success`; the UI can remain stale if polling/reconcile path is broken or too slow.

4. Mock should simulate async lifecycle, not bypass it.
A valid mock must still go through `202 accepted -> poll -> running/success|failed` transitions.

## Test method (realistic mock)

Method used for reliable diagnosis:
- force mock-sim model (`mock-sim-*`) to avoid Gemini cost
- keep async pipeline path enabled
- submit tasks as real async requests (`/api/asset/image/generate` with `async:true`)
- poll `/api/pipeline/tasks/:id` and assert status transitions + terminal payload
- run burst queue and high-priority task together
- optionally include scaffold + asset chain

This keeps the exact backend queue/status/state flow, while replacing only model latency/response source.

## Command

```bash
npm run debug:iteration
npm run debug:iteration -- --include-scaffold
```

Default target: `http://127.0.0.1:3000`

Optional args:

```bash
node scripts/debug-iteration.mjs \
  --base http://127.0.0.1:3000 \
  --user debug-iteration \
  --timeoutMs 45000 \
  --taskBurst 4 \
  --include-scaffold
```

## Pass criteria

1. Pipeline status endpoint returns JSON (not HTML fallback).
2. Every submitted async task reaches terminal state within timeout.
3. Successful tasks contain `result.imageUrl`.
4. Burst queue scenario fully reconciles without orphaned tasks.
5. Blocked jobs use specific reasons (avoid generic `cancelled` when possible).
6. For `CREATE_SHOT`-triggered pipelines, prerequisite jobs are added only for missing dependencies.

## Failure triage order

1. Check status endpoint shape
- `GET /api/pipeline/tasks/:id` must return `{ ok: true, task: ... }`.

2. Check linkage retention
- project state must keep `pipelineTaskId/statusUrl` until success/failed reconcile.

3. Check queue metrics
- `GET /api/pipeline/metrics` for running/queued pressure.

4. Check persisted task state
- `.vision-pipeline/tasks.json` for actual backend task terminal status.

5. Check cancellation semantics
- `scope=asset.exec` blocked events should prefer explicit reasons (`cancelled: key-marked`, `...:shot-missing`, etc.).
- Generic `cancelled` should be treated as incomplete observability and investigated.

## Scope and limits

This harness validates end-to-end task orchestration and reconciliation behavior.
It is intentionally heavier than unit tests and should be run:
- before/after major task-pipeline refactor
- during hard-to-reproduce state mismatch incidents
