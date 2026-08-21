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

- Within one Codepet Platform environment, Pika and Bara use separate WorkOS
  AuthKit Applications and sessions. Each product keeps its own client,
  application-scoped API key, callbacks, and cookie secret while sharing the
  environment's user directory. Codepet Labs is a separate WorkOS project.
- Development uses the Bara Application in Codepet Platform Staging and an
  `sk_test_` API key.
- Production uses the Bara Application in Codepet Platform Production and an
  `sk_live_` API key.
- Each environment must configure Bara's callback URI, homepage URL, CORS
  origin, and cookie secret independently from Pika.
- Convex development and production deployments each receive the matching Bara
  `WORKOS_CLIENT_ID`.
- Convex validates the environment issuer and Bara rejects identities whose JWT
  `client_id` does not match Bara's application ID.

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

A same-client/shared-cookie Pika-to-Bara session was verified locally on
2026-08-17, but it is not the production boundary. Native Pika attendance keeps
the Pika and Bara WorkOS Applications and browser sessions separate and does
not create a Bara browser session. Pika derives an attendance actor from its
verified server session; Bara maps or narrowly provisions the signed principal
inside its own internal identity and authorization model. Standalone Bara keeps
its independent AuthKit flow.
