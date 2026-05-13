# AI Current State

## Purpose

Tapcheck is a mobile-first classroom attendance app. It is now the first consumer of a shared identity platform implemented in Convex, while live attendance collection still happens through editor token links.

## Auth Architecture

- WorkOS AuthKit is the active authentication provider for the Next.js app.
- Tapcheck does not use provider user IDs as domain ownership IDs.
- Internal identity and authorization are modeled with Convex tables:
  - `app_users`
  - `auth_identities`
  - `organizations`
  - `organization_memberships`
  - `roster_access`
- `auth_identities` links an external auth provider identity to the internal `app_users` record.
- Auth provider records store a provider key plus the JWT issuer and subject so future providers or sibling apps can be handled without changing domain ownership tables.
- New provider identities can link to an existing `app_user` by verified email when there is exactly one verified-email owner.
- Dev smoke-test seed data can pre-create a student `app_user` plus verified email identity placeholder; the real WorkOS student identity links to that same internal user on first verified sign-in.
- Provider resolution should prefer explicit issuer mapping through `TAPCHECK_AUTH_PROVIDER_ISSUER_MAP`; WorkOS client issuers are mapped from `WORKOS_CLIENT_ID`.
- Resolve the current user in Convex from `ctx.auth.getUserIdentity()` and `tokenIdentifier`, not from any client-supplied user identifier.
- `email` is optional in auth-linked identity snapshots because provider claims reaching Convex may omit it.
- Student QR check-in can self-provision a student membership only when a verified auth email uniquely matches an active roster participant email.

## Authorization Boundaries

- Dashboard routes are authenticated.
- Public auth routes are `/sign-in` and `/sign-up`.
- Public attendance collection remains available at `/s/edit/[token]`.
- Rosters are organization-owned.
- Access is enforced through active `organization_memberships` plus explicit `roster_access`.
- Canonical roles are `student`, `staff`, and `admin`.
- `organization_external_links` stores future mappings from local organizations to external systems such as Pika or a shared SaaS identity/org provider.

## Current Backend Conventions

- Current domain tables are:
  - `rosters`
  - `participants`
  - `sessions`
  - `attendance_records`
- Use shared Convex auth helpers for:
  - current app user bootstrap
  - current user lookup
  - organization membership checks
  - roster access checks
- This branch does not preserve legacy local Convex data. If the schema changes incompatibly during local development, reset or reseed the local dataset instead of reintroducing compatibility layers unless the task explicitly requires a migration-safe rollout.

## Current Frontend Conventions

- WorkOS AuthKit is the current frontend auth adapter and is wired through `proxy.ts`, `/sign-in`, `/sign-up`, `/callback`, and the Convex client provider.
- Use the official WorkOS CLI when available and appropriate. High-value commands include `workos doctor --mode agent --json --skip-ai`, `workos config redirect add <uri>`, `workos config homepage-url`, `workos user list`, and `workos invitation send`. Treat CLI output as diagnostic evidence, but verify app behavior locally.
- Do not run `workos install` or scaffold/fix commands over Tapcheck's existing auth integration unless explicitly requested; the app intentionally keeps a custom AuthKit + Convex bridge in `components/convex-client-provider.tsx`.
- Protected pages should wait for app-user bootstrap before issuing protected Convex queries.
- Auth UI should stay minimal and use WorkOS AuthKit hosted flows rather than rebuilding auth screens inside Tapcheck.
- For UI/UX work, follow `docs/ai-ui-ux.md` as the design guidance source for primitives, composition, spacing, and visual tone.

## Local Worktree Conventions

- Do implementation work from git worktrees under `/Users/stew/Repos/.worktrees/tapcheck/`, not from the hub checkout.
- For every new worktree, symlink `.env.local` to `/Users/stew/Repos/tapcheck/.env.local` so WorkOS and Convex local environment settings stay consistent across worktrees.
- Install dependencies inside each worktree with `pnpm install`. Do not symlink `node_modules` from the hub checkout into a worktree; Next.js 16/Turbopack will crash when the symlink points outside the worktree root.

## Testing Harness

- Treat the existing test setup as part of the architecture, not as optional cleanup.
- Use `docs/system/testing-strategy.md` as the source of truth for the current minimum test surface.
- Convex behavior should be covered with `convex-test` tests in `convex/*.test.ts`.
- UI behavior should be covered with focused Vitest component/page tests where practical.
- Prefer extending existing tests when changing behavior instead of creating parallel test styles for the same surface.
- Add or update tests when a change affects:
  - auth or ownership boundaries
  - dashboard or roster list states
  - roster import flows
  - roster detail or session actions
  - collection screen states and interactions
  - shared primitives used across screens
- For auth and ownership work, add or update tests that prove:
  - user bootstrap behavior
  - org membership and roster-access boundaries
  - public token routes remain public
- Before closing substantial work, run the relevant local checks, usually:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`

## Evidence-Based Change Rules

- Read the relevant implementation and existing tests before proposing or making structural changes.
- Use current repo evidence, local docs, and library guidance over memory when framework behavior may have changed.
- Do not introduce new abstractions, migrations, or architecture changes unless the current code or requirements justify them.
- When making a recommendation, tie it to concrete repo constraints such as current schema, current route model, or current test coverage.
- If a behavior is security-sensitive or access-sensitive, verify it with code inspection and tests rather than relying on intent.
