# WorkOS AuthKit Migration Review

## Review

- The visible product screens stay understandable because the migration changes auth plumbing, not attendance workflows.
- The header action remains minimal: signed-out users see `Sign in` and `Sign up`; signed-in users see `Sign out`.
- Protected route behavior is clearer now because `/attendance/create` and `/check-in/[token]` are explicitly protected in `proxy.ts`.
- The main follow-up risk is WorkOS JWT claims: Tapcheck can bootstrap users from `sub`, but email/name-dependent student matching needs WorkOS claims or membership provisioning.
- The shared `.env.local` must contain WorkOS values before `npx convex dev` can sync the new auth config.

## Follow-Ups

- Configure WorkOS AuthKit redirect URIs and sign-in endpoint in the WorkOS dashboard.
- Set `WORKOS_CLIENT_ID` in Convex deployment env and run `npx convex dev` or deploy to sync auth config.
- Decide whether WorkOS JWTs should include email/name claims for smoother student account matching.
