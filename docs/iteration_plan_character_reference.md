% Character Reference Iteration Plan (v1)
Date: 2026-02-05
Branch: iter-character-reference
Scope: Character reference system + more asset types

## Goals
- Enable consistent character identity across all generated assets.
- Support user-provided reference images as identity anchors.
- Expand asset references to include important props/objects for continuity.
- Make reference usage transparent and controllable (UI + Director Console).

## Key Decisions (Pending)
1) **Upload Timing**
   - Option A: Require user upload before generation starts (creation flow gate).
   - Option B: Allow upload later in Character Editor (per‑character).
   - Option C: Allow both (soft gate with warnings + later edits).

2) **Director Console Attachments**
   - Should the Director Console allow image attachments?
   - If yes: where do attachments map? (character avatar / look / prop / environment)

3) **Reference Priority Rules**
   - If user uploads a photo, should it override generated avatar?
   - Per‑look reference vs. base avatar reference preference.

4) **Storage & Lifecycle**
   - Where to store user uploads (local, backend, object storage)?
   - Persistence across sessions and deletion rules.

## Planned Features
### A) Character Reference System
- Add **Reference Upload** entry in Character Editor.
- Add **Active Reference** selector for avatar + per‑look reference.
- Enforce **one reference per character per shot** (already fixed for storyboard).
- Add **Reference Audit** panels (done for storyboard) to other asset flows.

### B) Upload Flow
- Creation flow: optional “Upload reference images” step.
- Character Editor: upload/replace reference for base avatar and looks.
- Director Console: optional attachments with intent extraction (character/prop).

### C) New Asset Types (Props/Objects)
- Add “Props” as a new asset type with variants and active selection.
- Include selected prop references in storyboard/video prompts.
- Define dependency order: props generated after characters/looks.

### D) Prompt & Reference Governance
- Standardize prompt templates to explicitly mention active reference usage.
- Add warnings if reference is missing or placeholder when generating.
- Provide toggle to “force reference only” vs. “allow creative.”

## UX Updates
- Visual indicator of active reference (avatar/look/prop).
- Reference list view with status (ok/placeholder/missing).
- Copyable “effective reference list” for debugging.

## Backend / Data Model (Tentative)
- `Character.referenceImages[]` (type, url, source, createdAt).
- `Character.activeReferenceId`
- `CharacterLook.referenceImages[]`, `activeReferenceId`
- `Prop` entity with `versions[]`, `activeVersionId`.

## API / Storage
- Upload endpoint (if backend): `POST /api/assets/upload`.
- Local fallback: `localStorage` or `/__generated__/` path (TBD).
- Access control for Director Console attachment usage.

## Tasks (High Level)
1) Decide upload timing (A/B/C).
2) Add data models for reference assets.
3) Build upload UI in Character Editor.
4) Implement Director Console attachments.
5) Add props asset type + UI.
6) Wire reference selection into asset generation.
7) Add audits for reference usage.

## Risks
- Inconsistent identity if references are missing.
- Too many refs per generation (provider limits).
- Storage location unclear (local vs. backend).

## Next Steps
- Confirm decisions in **Key Decisions**.
- Define storage strategy.
- Draft UI wireframes (Character Editor + Console).
