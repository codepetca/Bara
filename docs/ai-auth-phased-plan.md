# Bara Auth Architecture

Bara uses:

- Next.js App Router
- WorkOS AuthKit for authentication and session management
- Convex for internal users, authorization, rosters, and attendance
- WorkOS Hosted UI for sign-in, sign-up, password recovery, and configured identity providers

## Identity boundary

- WorkOS owns external identities and browser sessions.
- Convex owns canonical `app_users`, organizations, memberships, roles, roster access, and attendance permissions.
- Never use a WorkOS user ID as a domain ownership ID.
- Resolve the current app user from the verified Convex auth identity and link it through `auth_identities`.
- Students can remain roster-only records until a verified self-check-in flow requires an authenticated identity.

## Route model

- `/sign-in` starts the WorkOS sign-in flow.
- `/sign-up` starts the WorkOS sign-up flow.
- `/callback` completes the AuthKit flow and creates the encrypted session cookie.
- `/`, `/rosters/*`, and `/check-in/*` require authentication.
- `/s/edit/*` and `/s/display/*` remain public token routes.

## Environment model

- Development uses a dedicated Bara WorkOS development environment and an `sk_test_` API key.
- Production uses a separate Bara WorkOS production environment and an `sk_live_` API key.
- Each environment must configure its own callback URI, homepage URL, CORS origin, and cookie secret.
- Convex development and production deployments each receive the matching `WORKOS_CLIENT_ID`.

## Future capabilities

- Enable Google or Microsoft social login in WorkOS without changing Convex ownership.
- Add school SSO or directory provisioning only when a customer needs it.
- Keep application roles in Convex unless a deliberate authorization redesign moves a specific policy to WorkOS.

## Verification

- Sign-in reaches a real WorkOS authorization URL.
- Callback completion returns to Bara without an OAuth state mismatch.
- `useConvexAuth()` reaches the authenticated state.
- Convex creates one `app_users` row and one WorkOS `auth_identities` row for the new account.
- A second account cannot access the first account's rosters.
