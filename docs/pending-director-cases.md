# Director Pending Cases

Last updated: 2026-02-09

This file tracks unresolved/fragile director-command behaviors for later revise.

## Open Cases

1. `DELETE_CHARACTER_LOOK` appears in model output but app has no executable support.
- Symptom: model reply says "look removed", but action is dropped as unknown or ignored.
- Risk: user believes destructive change happened when it did not.
- Expected: unsupported destructive actions should require explicit confirmation flow or be blocked with clear feedback.
- Status: pending.

2. Raw-wrapped payload fields (`_raw`) from agents.
- Symptom: `patch._raw` / `metadata._raw` carry true intent, but action execution misses flags/patch fields.
- Example: `regenerateDependents` hidden under `metadata._raw` so dependent regeneration does not run.
- Status: partially mitigated by action normalization; keep monitoring.

3. Character update + dependent regeneration chain can skip look update or block shot jobs.
- Symptom: shot job blocked with `look not bound to active avatar`.
- Root cause: look jobs pinned to stale avatar version while character avatar changed in same batch.
- Status: mitigated by unpinning look jobs when character jobs are in same batch; monitor for regressions.

4. "Looks should be strong-bound" expectation mismatch.
- Symptom: some character updates regenerate avatars but not all looks, then keyframe update appears missing.
- Current behavior: looks regenerate only in specific mutation paths or cast-linked prerequisites.
- Status: product decision pending (strict strong-binding vs scoped regeneration).

5. Streaming director request can end without `result`.
- Symptom: `Streaming ended without result`.
- Status: mitigated via stream tail parse + non-stream fallback; keep metric.

6. Safety-filtered video generation reported as generic server failure.
- Symptom: `no downloadable video URI` looked like infra bug.
- Status: mitigated with explicit `RAI_MEDIA_FILTERED` classification; keep UX copy review.

## Related Cases To Watch

1. Bundled directives (`update + regenerate + delete`) may include unsupported action types mixed with valid ones.
2. Conditional directives (`only if`, `if needed`) may become unconditional generation.
3. Multi-step directives may produce action-order drift (generation before mutation).
4. Unsupported destructive operations should never silently no-op.
5. Stage preview should not revert to placeholder while shot keyframes are still generating (mitigated by preferring latest real keyframe in preview selection).

## Dummy Validation Flow (No Real Asset Production)

Use this to validate command understanding and action shape only.

1. Run local app server (`npm run dev` or preview server).
2. Run:

```bash
npm run check:director:dummy
```

3. Optional strict mode (non-zero exit on warnings):

```bash
node scripts/validate-director-actions.mjs --base http://127.0.0.1:3000 --strict
```

What it checks:
- Unknown action types (especially unsupported destructive actions).
- Missing required payload fields per action type.
- `_raw` wrapping presence in payload/patch/metadata.
- Bundled/conditional intent signals (for "sync keyframes" requests).
- Action order sanity (mutation should come before generation).

This flow does not call asset generation endpoints, so it is cheap and fast.

## Next Revise Targets

1. Destructive action confirmation queue (supports multiple pending deletes with blocking/ordering).
2. Explicit capability map returned to model layer so unsupported actions are less likely.
3. Add integration tests around dependency batches (`character -> look -> shot`) to prevent block regressions.
