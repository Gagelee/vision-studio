# Masterpiece AI Director: Design System & VI Guidelines

## 1. Brand Essence
**Masterpiece AI** is a high-end cinematic tool designed for "Auteurs." The visual identity centers on **Cinematic Minimalism**—blending the sleek precision of high-tech interfaces (Apple-inspired) with the evocative atmosphere of a film production studio.

*   **Tagline:** "Direct your Vision."
*   **Core Value:** Empowerment through narrative scaffolding and visual intention.

---

## 2. Visual Foundation

### 2.1 Color Palette
The system utilizes a "Void & Light" approach, using deep blacks to create depth and light only to guide focus.

| Token | Value | Usage |
| :--- | :--- | :--- |
| **Pure Void** | `#000000` | Primary background, high-contrast states. |
| **Studio Black** | `#050505` / `#0a0a0a` | Component backgrounds, layer depth. |
| **Glass Base** | `white / 5%` | Subtle containers, backdrop filters. |
| **Text Primary** | `white / 100%` | Headings, active states. |
| **Text Secondary** | `white / 40%` | Placeholders, inactive labels, subtext. |
| **Text Tertiary** | `white / 10%` | System metadata, borders. |
| **Accent Glow** | `blue-600/10` | Neural mesh background (ambient). |

### 2.2 Typography
We use **Inter** for its modern, neutral, and readable characteristics, pushed to extremes of weight and tracking.

*   **Hero Headers (H1):** 
    *   Weight: `ExtraLight (100)` paired with `Medium Italic (500)`.
    *   Size: `72pt - 100pt`.
    *   Letter Spacing: `tight`.
*   **UI Labels / Metadata:**
    *   Case: `UPPERCASE`.
    *   Weight: `Black (900)`.
    *   Letter Spacing: `0.4em - 0.8em`.
    *   Size: `8pt - 10pt`.
*   **Input Text:** 
    *   Weight: `Light (300)`.
    *   Size: `18pt`.

---

## 3. UI Component Specifications

### 3.1 The "Inviting" Input
A central affordance designed to transition users from "Thinking" to "Directing."
*   **Shape:** Full Pill (`rounded-full`).
*   **Idle State:** 20% white border, subtle breathing glow (`animate-pulse`).
*   **Interaction:** Typing activates a shimmer effect; focus increases border opacity to 60%.
*   **Affordance:** A pulsing `Sparkles` icon on the left indicates AI readiness.

### 3.2 Aspect Ratio Selectors
Tactile cards that represent cinematic frames.
*   **Active:** Black on White (`bg-white text-black`), 105% scale, heavy shadow.
*   **Inactive:** 10% white background, 40% opacity.
*   **Icons:** Minimalist vector boxes representing the frame shape.

### 3.3 Glassmorphism Layering
*   **Blur Factor:** `backdrop-blur(40px - 60px)`.
*   **Border:** `1px solid rgba(255, 255, 255, 0.1)`.
*   **Overlay:** A subtle grain texture (`noise.svg`) at 10% opacity to prevent banding.

---

## 4. Motion & Experience Principles

### 4.1 Cinematic Transitions
The application uses a **Vertical Layer System** to mimic camera panning or film strip movement.
*   **Curve:** `cubic-bezier(0.2, 0.8, 0.2, 1)` (Apple Ease).
*   **Duration:** `1200ms` for primary view changes.
*   **Logic:**
    *   Landing → Setup: Landing slides UP, Setup enters from BOTTOM.
    *   Setup → Studio: Setup slides UP, Studio enters from BOTTOM.

### 4.2 Interactive Feedback
*   **Scaling:** All buttons should have an `active:scale-95` state for tactile feedback.
*   **Hover:** Smooth `duration-500` transitions for all opacity and color changes.
*   **Stagger:** Content within views should use `fade-in slide-in-from-bottom` animations.

---

## 5. Iconography Guidelines
*   **Library:** Lucide-React.
*   **Stroke Width:** 
    *   Functional (Close, Back): `2`.
    *   Atmospheric (Sparkles, Arrow): `1.5 - 3` (3 for primary action buttons).
*   **Sizing:** 
    *   Standard: `20px`.
    *   Primary Action: `24px`.
    *   Metadata: `12px`.
