# Tapcheck Design Guidance

Use this file as the short design brief for any AI making UI changes in this repo.

This file does not replace the existing design docs. It tells you which ones to read and how to apply them in order.

## Read Order

Before substantial UI work, read these in this order:

1. `DESIGN.md`
2. `docs/ai-ui-ux.md`
3. `docs/system/app-dna.md`
4. `docs/system/product-principles.md`
5. `docs/system/ui-patterns.md`
6. `docs/system/anti-patterns.md`

If the change is meaningful, also use:

- `docs/system/screen-review-rubric.md`
- `docs/workflow/post-implementation-review.md`

## Product Feel

Tapcheck should feel:

- quiet
- practical
- mobile-first
- teacher-first
- lightly structured

It should not feel like:

- admin software
- a dashboard
- a design exercise
- a feature demo

The target is confident restraint. Keep the interface easy to understand in two seconds.

## Core UI Rules

- Preserve the minimal Tapcheck aesthetic that existed before the QR feature made some screens louder.
- Prefer one primary surface and one primary action per screen.
- Make secondary actions available but visually quiet.
- Build on the existing shells and primitives before inventing a new layout.
- Keep copy short. If a sentence can become a label, do that.
- Optimize for phone use first, then make desktop spacing breathe.

## Existing Visual Language

- Light surfaces, subtle borders, low-contrast depth.
- `Geist` for body text and `Sora` for headings.
- Rounded containers are the norm:
  - page cards around `rounded-[28px]`
  - nested rows around `rounded-[24px]`
  - buttons use `rounded-full`
- Palette stays restrained:
  - slate for structure and text
  - white and near-white surfaces
  - emerald for positive state
  - rose for destructive state
  - amber only when a warning really matters

## Current Taste

This repo now has a clearer taste than “minimal” by itself. Preserve these choices:

- Use dark slate for tappable utility actions, not pure black.
- Use amber-orange for caution actions like stopping or closing a live flow.
- Use rose/red only for truly destructive actions like delete.
- Keep positive state in emerald, mostly as state feedback rather than as the default button color.
- Count pills should be symmetrical, compact, and quiet:
  - same height as adjacent controls
  - same font size and weight on both sides
  - color difference should carry the meaning, not typography
- Split buttons should feel like one control:
  - shared height
  - visually joined halves
  - open action on the left, copy/support action on the right
- Utility controls should feel firm and tappable, but not loud or dashboard-like.

## Theme Tokens

The shared palette now starts in `app/globals.css`. Prefer these token names before inventing one-off colors:

- `--color-surface`
- `--color-surface-muted`
- `--color-surface-success`
- `--color-surface-danger`
- `--color-text-muted`
- `--color-border-subtle`
- `--color-border-default`
- `--color-ring-subtle`
- `--color-action`
- `--color-action-hover`
- `--color-success`
- `--color-success-soft`
- `--color-warning`
- `--color-warning-hover`
- `--color-danger`
- `--color-danger-hover`

Use shared primitives that already consume these tokens before applying direct slate, emerald, amber, or rose classes in a page.

## Action Hierarchy

Use this order of emphasis unless a screen has a strong reason not to:

1. Primary task action
   Usually full-width near the top on mobile.
2. Utility actions
   Present, clearly tappable, but visually calmer than the primary task.
3. Caution actions
   Amber-orange. Use only when the user is ending or interrupting an active flow.
4. Destructive actions
   Rose/red. Keep separated and confirm them.

Avoid making every available action look primary.

## Composition Guidance

- Start with `PageShell`, `AuthShell`, `Card`, `Button`, and existing small shared components.
- Prefer a stack of simple sections over many nested cards.
- Keep lists calm and tappable, not table-like or badge-heavy.
- Put the main action near the top and within easy thumb reach on mobile.
- Treat QR, sharing, exports, and similar tools as support for the main task unless the screen exists solely for that purpose.

## What AI Should Avoid

- Do not introduce a new visual language for one feature.
- Do not make screens louder with extra gradients, tinted blocks, or heavy shadows.
- Do not give equal visual weight to every action.
- Do not add metadata just because it is available.
- Do not create bespoke wrappers when a primitive variant or composition will do.
- Do not import generic SaaS dashboard patterns into Tapcheck.

## Decision Heuristics

When choosing between two UI approaches, prefer the one that:

- reduces cognitive load
- shortens the path to the next task
- removes a container instead of adding one
- reuses a proven pattern
- keeps the screen understandable without explanation

## Verification

Before closing meaningful UI work:

- verify the changed screen in the browser when possible
- check mobile-scale comfort and desktop spacing
- update the nearest existing test if behavior changed
- run `pnpm test`, `pnpm typecheck`, and `pnpm build`

If a screen feels denser, louder, or more decorative than the home, roster, or auth flows, simplify it again.
