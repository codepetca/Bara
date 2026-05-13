# WorkOS AuthKit Migration

## User Goal

Hard-cut Tapcheck alpha auth to WorkOS AuthKit so Tapcheck can use the same external identity direction planned for Pika, Repocat, and future SaaS apps.

## UX Flow

Staff and students use `/sign-in` or protected-route redirects to enter WorkOS AuthKit, return through `/callback`, then continue using the existing Tapcheck dashboard, roster, and QR check-in flows.

## Architecture Plan

- Use `@workos-inc/authkit-nextjs` for app/provider wiring.
- Use AuthKit session proxy on all app routes, redirect only protected Tapcheck routes.
- Use `ConvexProviderWithAuth` with AuthKit access tokens.
- Configure Convex auth for WorkOS JWT issuers only.
- Keep `app_users` and `auth_identities` as Tapcheck's internal auth model.

## Risks

- Existing alpha users from previous auth experiments become orphaned, by decision.
- WorkOS JWT claim configuration affects whether Tapcheck sees email/name.
- Convex auth must be synced with `npx convex dev` or deploy after provider changes.

## Acceptance Criteria

- No runtime imports from previous auth providers remain in app code.
- `/sign-in`, `/sign-up`, `/callback`, protected staff routes, and QR check-in use WorkOS.
- Convex auth config requires `WORKOS_CLIENT_ID`.
- Existing auth, route, typecheck, build, and lint validation pass.
