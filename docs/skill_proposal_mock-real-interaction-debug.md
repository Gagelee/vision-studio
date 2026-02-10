# Skill Proposal: `mock-real-interaction-debug`

## Goal

Create a reusable skill for diagnosing async state mismatch bugs by replaying realistic interaction flows with mock-simulated model responses and real backend pipeline orchestration.

## Trigger conditions

Use this skill when any of the following appears:
- generated asset/video exists but UI remains `queued/running`
- front/back state mismatch after retries
- orphaned tasks (`lost taskId/statusUrl linkage`)
- queue behavior/regression after pipeline refactor
- expensive real-provider calls block iteration speed

## Core workflow

1. Baseline status-surface checks
- verify `/api/pipeline/tasks` and `/api/pipeline/tasks/:id` return expected JSON schema
- verify `/api/pipeline/metrics` responds

2. Run realistic mock interaction harness
- execute scripted async generation scenarios with `mock-sim-*`
- assert transition sequence: `accepted -> queued/running -> success|failed`
- assert terminal payload integrity (`result.imageUrl` / `result.videoUrl`)

3. Run burst queue + priority scenario
- submit mixed normal/high-priority jobs
- capture wait times and start order evidence

4. Optional scaffold chain scenario
- run scaffold in mock-sim mode
- run master-kv-like async generation
- verify end-to-end state reconciliation

5. Emit triage report
- root-cause candidate
- failing seam (routing, polling, linkage, timeout, queue)
- patch targets and verification evidence

## Expected bundled resources

- `scripts/debug-iteration.mjs`
- `references/debug_iteration_playbook.md`
- `references/state_reconcile_checklist.md`
- optional `assets/sample-debug-report.md`

## Success criteria

- Skill produces reproducible, low-cost diagnostics without calling real provider APIs.
- Skill outputs a concrete timeline and failing seam, not generic hypotheses.
- Skill distinguishes provider failure from orchestration failure.

## Non-goals

- Replace unit/integration tests.
- Run on every small commit.

## Adoption plan

Phase 1:
- keep as docs + script workflow in repo.

Phase 2:
- package as Codex skill folder with SKILL.md + references + script aliases.
- add “major refactor release gate” checklist item to run this skill.
