# Agent Prompt Review (Draft)

Date: 2026-02-04
Repo: `shopee-vision-studio---aigc-director`

Purpose: capture current prompt inventory + improvement proposals for later review/approval.

---

## Prompt Inventory (Entry Points)

### Scaffold (single-call fallback)
- `lib/ai/prompts/scaffold.ts` — `buildScaffoldPrompt()`
  - Generates: `title`, `logline`, `styleGuide`, `locations`, `characters`, `sequences[].shots[]` + per-shot `videoPrompt`.
  - Used when multi-agent scaffold fails or single-call path is chosen.

### Scaffold (multi-agent)
- `lib/ai/prompts/team.ts` — `buildTeamScaffoldDirectorBriefPrompt()`
- `lib/ai/prompts/team.ts` — `buildTeamScaffoldScriptWriterPrompt()`
- `lib/ai/prompts/team.ts` — `buildTeamScaffoldCastingDirectorPrompt()`
- `lib/ai/prompts/team.ts` — `buildTeamScaffoldEnvironmentDirectorPrompt()`
- `lib/ai/prompts/team.ts` — `buildTeamScaffoldEditorPrompt()`
- `lib/ai/prompts/team.ts` — `buildTeamScaffoldCameraArtPrompt()`
- `lib/ai/prompts/team.ts` — `buildTeamScaffoldDirectorMergePrompt()`

### Director (chat-driven actions)
- `lib/ai/prompts/director.ts` — `buildDirectorActionsPrompt()` (single-call)
- `lib/ai/prompts/team.ts` — `buildTeamDirectPlannerPrompt()` (multi-agent planner)
- `lib/ai/prompts/team.ts` — `buildTeamDirectSpecialistPrompt()` (multi-agent specialist)
- `lib/ai/prompts/team.ts` — `buildTeamDirectMergePrompt()` (multi-agent merge)

### Assets (image prompts)
- `lib/ai/prompts/assetAuto.ts` — `buildMasterKeyVisualPrompt()`
- `lib/ai/prompts/assetAuto.ts` — `buildLocationPreviewPrompt()`
- `lib/ai/prompts/assetAuto.ts` — `buildCharacterAvatarPrompt()`
- `lib/ai/prompts/assetAuto.ts` — `buildCharacterLookPrompt()`
- `lib/ai/prompts/image.ts` — `buildShotImagePrompt()` (used inside storyboard keyframe prompt composition)

---

## Current Issues / Optimization Ideas

### A) Scaffold: video prompt structure + style stability
Target: reduce missing fields and prevent style drift across assets.

1) Enforce `videoPrompt` format in BOTH paths (single-call scaffold + multi-agent camera_art):
   - Require a fixed header/sections, e.g.
     - `STYLE:` (derived from `styleGuide`, concise)
     - `ENV:` (location + set cues)
     - `CAST:` (who appears + look)
     - `ACTION:` (blocking)
     - `CAMERA:` (lens, movement, framing)
     - `LIGHT:` (key/fill/rim, mood)
     - `NEGATIVE:` (no text/watermark/logo, no style shifts)

2) Make `styleGuide` output more “machine-readable”:
   - 8–14 lines, each prefixed with `- `
   - Must include: rendering medium/style, palette, lighting mood, camera language, negative constraints

3) Keep reference policy explicit:
   - References are for identity/space continuity, not a style source.
   - Visual style must follow `styleGuide`.

### B) Multi-agent Scaffold: preserve “identity anchors” end-to-end
Problem: casting step can create `identityAnchors`, but final story schema currently loses them.

1) Promote `identityAnchors` into the final merged scaffold output (requires schema/types/UI decision):
   - Option 1 (recommended): add `characters[].identityAnchors: string[]`
   - Option 2: merge anchors into `characters[].description` (no schema change, less controllable)

2) Tighten casting rules:
   - Separate immutable (face proportions) vs mutable (hair/outfit) attributes
   - Look descriptions must include reproducible details: silhouette, material, palette, accessories, era

### C) Director prompts: action list reliability + artistic control

1) Fix `buildDirectorActionsPrompt()` “Allowed AgentAction types” listing:
   - Currently has confusing numbering collisions (e.g. `2)` used for different items).
   - Improve by listing as bullet/sections without numeric prefixes.

2) Add `styleGuide` support to story updates:
   - Extend `UPDATE_STORY.patch` to include `styleGuide?: string`
   - This enables director to actually steer art core post-scaffold.

3) Pipeline-aware generation:
   - When user asks to generate storyboard/frames, director should schedule prerequisites first:
     - env → avatar → look → shot image
   - If prerequisites missing, either emit prerequisite generation actions or a clear “blocked” plan.

4) Multi-agent Direct planner schema stability:
   - Current planner returns `focus` as an object map.
   - Some Gemini response-schema validators can be strict; consider switching to:
     - `focus: Array<{ agent: TeamAgent, focus: string }>`

### D) Asset prompts: avatar style strategy decision (needs product choice)

Problem: If `styleGuide` is painterly but avatar prompt forces “true-to-life”, assets can become inconsistent
(e.g. realistic characters + ink-wash environments).

Two strategies to choose:
1) Strategy A (identity-first):
   - Avatar is always clean studio photoreal reference.
   - Shots MUST state: “refs are identity only; rendering style follows styleGuide”.

2) Strategy B (style-consistent) — recommended for unified look:
   - Avatar is a clean turnaround/reference sheet BUT rendered in the project’s style (from `styleGuide`).
   - This reduces the chance refs “pull” shots into photoreal.

Additional asset prompt upgrades:
- Looks: require 2–3 angles (front/3-4/profile), not just one full-body shot.
- Environments: explicitly forbid humans; establish as set reference; include reproducible set cues.
- Shot keyframes: prefer structured key:value lines for `buildShotImagePrompt()` to reduce model confusion.

---

## Proposed Approval Batches (for next iteration)

Batch 1 (low risk, high ROI):
- Clean up director action list formatting (remove numbering collisions).
- Add `styleGuide` to `UPDATE_STORY.patch`.
- Make direct multi-agent planner `focus` schema more stable (array-based).
- Provide specialists the full allowed-action list to reduce invalid actions.

Batch 2 (medium risk, high ROI):
- Preserve `identityAnchors` through scaffold merge into final story schema.
- Use anchors in avatar/look/shot prompts.

Batch 3 (style strategy decision required):
- Choose avatar strategy A vs B.
- Implement chosen strategy consistently in avatar/look/shot prompts and the reference policy text.

---

## Debug Iteration Addendum (2026-02-11)

For pipeline/task-tracking regressions, use the heavy mock interaction harness instead of relying only on unit tests.

- Playbook: `docs/debug_iteration.md`
- Postmortem: `docs/task_tracking_postmortem_2026-02-11.md`
- Skill proposal: `docs/skill_proposal_mock-real-interaction-debug.md`
- Runner: `scripts/debug-iteration.mjs`
