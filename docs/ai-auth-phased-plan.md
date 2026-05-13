# Tapcheck Auth Architecture Plan

This plan documents the current WorkOS AuthKit direction and replaces earlier hosted/custom auth exploration.

## Current decision

- WorkOS AuthKit is the external identity provider.
- Tapcheck does not run a separate `codepet-auth` service.
- Tapcheck keeps its internal auth model: `app_users` plus `auth_identities`.
- Authorization stays in Convex through organizations, memberships, roster ownership, and roster access.
- WorkOS identity is treated as a provider identity, not as Tapcheck's domain user id.

## Why

WorkOS gives Tapcheck hosted auth, shared identity direction for Pika/Repocat/future apps, low cost up to the expected early scale, and less operational burden than maintaining a custom auth service.

## Implementation rules

- Use WorkOS AuthKit hosted flows for sign-in, sign-up, callback, and session management.
- Use WorkOS access tokens with `ConvexProviderWithAuth`.
- Convex validates WorkOS JWTs in `convex/auth.config.ts`.
- Store WorkOS identities in `auth_identities` with `provider: "workos"`.
- Prefer `identity.tokenIdentifier` for identity lookup.
- Link by verified email only when the match is unique.
- Keep student/teacher/app roles out of WorkOS claims unless there is a specific cross-app reason.

## Migration order

1. Keep Tapcheck on WorkOS AuthKit.
2. Configure WorkOS production redirect URLs and JWT claims.
3. Verify Tapcheck QR check-in with WorkOS accounts that include verified email claims.
4. Move Pika to WorkOS after Tapcheck is stable.
5. Add Repocat and future apps using the same WorkOS identity pattern.

## Out of scope

- Additional hosted auth providers.
- Better Auth.
- Supabase Auth.
- Custom email OTP infrastructure.
- A separate first-party `auth.codepet.ca` app.
