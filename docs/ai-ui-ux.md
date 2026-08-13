# AI UI / UX Guidance

Guidance for keeping Bara visually consistent as the UI grows.

This should preserve the current product feel: quiet, mobile-first, rounded, and lightweight. The goal is not novelty. The goal is confident restraint.

## Visual Direction

- Keep the UI minimal, soft, and calm.
- Prefer light surfaces, subtle borders, and low-contrast depth over heavy shadows or loud gradients.
- Use the existing palette family:
  - slate for primary text and controls
  - white and near-white surfaces
  - emerald for positive or active states
  - amber-orange for caution actions
  - rose for destructive or error states
- Favor generous rounding and compact copy over decorative flourishes.
- Avoid dashboard clutter. Most screens should feel like one primary surface with one or two secondary sections.

More specific taste decisions now in use:
- prefer dark slate utility buttons over pure black
- keep utility actions visibly tappable but softer than destructive or caution states
- use emerald mostly for state and confirmation, not for every CTA
- keep count pills symmetrical and quiet rather than badge-like

## Core Aesthetic Cues

- Rounded containers are a core part of the visual language.
  - page-level cards generally use `rounded-[28px]`
  - nested interactive rows often use `rounded-[24px]`
  - buttons use rounded-full
- Surfaces should usually look like:
  - `border border-white/70`
  - `bg-white/90`
  - light ring or very subtle shadow
- Typography should remain clean and restrained:
  - `Geist` for body
  - `Sora` for headings
  - short headings with tight tracking
  - muted supporting copy in slate tones

## Layout Rules

- Build around the existing page shells instead of inventing new page scaffolds.
- Prefer a narrow, centered layout:
  - `max-w-3xl` for app pages
  - `max-w-md` for auth pages
- Keep section spacing moderate. Current UI works because it breathes without feeling sparse.
- Mobile-first is the default. Controls should still work comfortably on phones before expanding for desktop.
- Important actions should be obvious and easy to tap, often as full-width controls on mobile.

## Work By Screen Family

Before making substantial UI changes, identify the related screen family and state family.

Examples:
- roster detail, manual attendance, QR attendance display, student check-in
- open, closed, loading, empty, success, warning, failure, invalid

Rules:
- if you refine one state, inspect the sibling states
- if you refine one screen in a workflow, inspect the sibling screens
- do not treat “looks good on this one page” as done if the same pattern exists elsewhere

## Primitive Components First

Prefer composing from the existing primitives before writing bespoke Tailwind blocks.

Current primitives and shells:
- `components/ui/button.tsx`
- `components/ui/card.tsx`
- `components/ui/dialog.tsx`
- `components/confirm-dialog.tsx`
- `components/page-shell.tsx`
- `components/auth-shell.tsx`

Shared theme tokens:
- `app/globals.css`

Rules:
- If a new visual pattern is just a button, card, or page-section variant, extend the primitive instead of restyling from scratch in a page.
- If a pattern appears in more than one place, promote it into a composable component instead of duplicating class strings.
- Keep logic outside presentation components where possible. Pages should compose shells, sections, and behavior hooks rather than holding every UI concern inline.
- Prefer the shared theme tokens in `app/globals.css` for palette decisions:
  - `--color-surface`, `--color-surface-muted`
  - `--color-action`, `--color-action-hover`
  - `--color-success`, `--color-success-soft`
  - `--color-warning`, `--color-warning-hover`
  - `--color-danger`, `--color-danger-hover`
  - `--color-border-subtle`, `--color-border-default`
  - `--color-text-muted`

Practical mapping:
- primary utility actions: `--color-action`
- support surfaces: `--color-surface`, `--color-surface-muted`
- positive state: `--color-success`, `--color-success-soft`
- caution state: `--color-warning`, `--color-warning-hover`
- destructive state: `--color-danger`, `--color-danger-hover`

## Composable UI Patterns

- Compose pages from a small number of clear sections:
  - shell
  - primary action block
  - content list or detail card
  - confirmation / modal flows
- Prefer a stack of simple sections over deeply nested cards inside cards.
- Lists should read as calm, tappable surfaces, not data-grid chrome.
- Status should be communicated with small badges, tint shifts, and concise labels rather than large alert banners unless the message is truly blocking.

For operational workflows, keep patterns parallel across screens:
- closed attendance should feel like the same state on manual and QR surfaces
- success and failure should share structure when they belong to the same student result flow
- shared counts, pills, and action groupings should reuse the same component or treatment

## Interaction Style

- Interaction feedback should be subtle and immediate.
- Hover states should slightly deepen contrast, not dramatically transform the element.
- Loading states should use simple skeleton blocks that match the final layout.
- Empty and error states should use the same card language as the rest of the app.
- Destructive actions should be clearly separated and confirmed, but still fit the same visual system.
- Split actions should read as one joined control when they represent one task with two outcomes, like open/copy.
- Adjacent controls should usually share height unless there is a clear reason to break alignment.

Operational-screen rule:
- when a teacher or staff member needs to verify something at a glance, prefer larger type, fewer words, and stronger full-screen or section-level status treatments over small explanatory cards

## Form Guidance

- Keep forms quiet and readable.
- Use a single strong primary action.
- Supporting instructions should be brief and close to the relevant control.
- Avoid dense control clusters when a vertical stack is clearer.
- Auth forms should stay minimal and use the custom auth shell around Clerk components.

## What To Avoid

- Do not introduce a second visual language for a single feature.
- Do not add component-library-style ornamentation or glossy marketing UI.
- Do not overuse bright accent colors, gradients, or heavy drop shadows.
- Do not default to pure black utility controls when dark slate will do the job more softly.
- Do not switch between inconsistent radii, padding scales, or button shapes.
- Do not create bespoke layout wrappers when `PageShell`, `AuthShell`, `Card`, or `Button` can carry the pattern.
- Do not import ideas from other repos that conflict with Bara’s lighter, simpler feel.
- Do not add subtitles, badges, or helper text that repeat what the title, color, or icon already communicates.
- Do not expose session or roster metadata on a live workflow screen unless it helps the next action.
- Do not make failure copy too specific on high-speed operational screens unless the specific reason changes the remedy.

## When To Create A New Primitive

Create or extend a primitive when:
- the same styling pattern appears in at least two places
- a page starts carrying repeated structural Tailwind strings
- a new interaction pattern needs consistent variants

Do not create a primitive just because a component is large. Create one when it improves reuse and keeps the visual system coherent.

## UI Verification

- After meaningful UI changes, inspect the actual rendered result before considering the work done.
- Prefer browser-based verification over reasoning from JSX alone.
- Check both:
  - mobile-scale behavior
  - desktop spacing and hierarchy
- Run a propagation pass before stopping:
  - inspect sibling screens in the same workflow
  - inspect sibling states in the same workflow
  - remove copy or ornamentation that is not earning its keep
- When a visual contract matters, add or update a Playwright fixture or snapshot rather than relying on memory.
- If a UI change feels visually louder or denser than the surrounding screens, it is probably off-pattern and should be simplified.
