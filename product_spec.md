
# Product Specification: Shopee Vision Studio

## 1. Project Hierarchy (Story Engine)
- **Story (Root)**: The project's visual and narrative constitution.
    - **Metadata**: Title, Logline, Intent, Master Key Visual (KV).
    - **Constraints**: `AspectRatio` (Locked at creation).
- **Sequence (Scene)**: A collection of shots forming a narrative beat.
- **Shot (Beat)**: The atomic unit of production.
    - **Elements**: Camera (Cinematography), Lighting (Atmosphere), Casting (Performance), Script (Dialogue), Audio (Soundtrack).

## 2. Core Modules & Features
### A. "One-Sentence" Production (Agent Scaffolding)
- **Workflow**: User inputs a high-level creative intent -> AI Agent generates the story, sequences, shots, locations, and characters automatically.
- **Cinema Mode**: Apple TV-style immersive preview for reviewing the "Master Cut".

### B. Asset Management (Consistency Engine)
- **Environments (Locations)**: Centralized library for set designs. Styles defined here are inherited by shots.
- **Casting (Characters & Looks)**: Centralized library for performers. 
    - **Identity**: Permanent facial and body traits.
    - **Looks (Wardrobe)**: Defined sub-variants (e.g., "Casual", "Tactical") that can be toggled per shot while maintaining facial consistency.
- **Visual Anchoring (KV Sync)**: The ability to extract visual parameters (lighting, lens type) from a Master Key Visual and apply them to specific shots.

### C. Director Console (Semantic Interface)
- **Commands**: Supports natural language directives to modify state (e.g., "Reverse timeline", "Apply cinematic lighting to all shots").

## 3. Current Implementation Log (May 2025)
- [x] Hierarchical Navigation (Sidebar).
- [x] Project Dashboard (Apple TV Style).
- [x] Shot-level Inspector with Element Controls.
- [x] Shot Versioning and Variant Generation.
- [x] Environment & Casting CRUD.
- [x] **Character Look System (Wardrobe Management)**.
- [x] Aspect Ratio Locking.
- [x] Timeline Mini-Map for Sequence Strip navigation.

## 4. UI/UX Principles
- **Aesthetics**: High-contrast dark mode, rounded corners (up to 32px), backdrop-blur effects.
- **Color Semantics**: 
    - Sky: Camera
    - Amber: Lighting
    - Indigo: Casting
    - Rose: Audio
