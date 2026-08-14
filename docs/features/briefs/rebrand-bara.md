# Establish Bara As The Canonical Brand

- User goal: make Bara the canonical name of the current attendance product and repository while keeping a future rename inexpensive.
- UX flow: existing teacher and public attendance flows remain unchanged; every current brand surface consistently presents Bara and the legacy Bara mark.
- Primary action: unchanged on every screen; the rebrand must not compete with attendance tasks.
- Architecture plan: add a dependency-free brand configuration for Next.js and authentication surfaces, use neutral asset paths, remove brand-specific Convex defaults, update current docs/tests/path guidance, and add a repeatable rebrand check and runbook.
- Risks: stale auth/domain callbacks, accidental changes to `app_users`/`auth_identities` or roster ownership, branded values already stored in Convex, and repository/worktree links that still target the former project name.
- Simplification pass: preserve the current layout and routes, keep Convex deployment/data identifiers stable, and keep legacy Swift/Flutter/Supabase histories in their existing repositories.
- Acceptance criteria: UI, metadata, auth, package, docs, assets, repository, and deployment-facing names use Bara; the product name is not hardcoded across application source; tests, typecheck, build, and visual/browser checks pass; future brand changes are documented and centrally controlled.
