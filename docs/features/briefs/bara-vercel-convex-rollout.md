# Bara Vercel + Convex rollout brief

## User goal

Deploy Bara's frontend and its matching Convex backend as one release, while
keeping preview and production isolated and preserving a safe rollback path.

## Operator flow

1. Configure a preview-scoped Convex deploy key and WorkOS staging credentials
   in Vercel.
2. Run the privacy-safe rollout preflight against exact Pika and Bara origins.
3. Let Vercel invoke the guarded build, which deploys Convex first and builds
   Next.js against the URL of that exact deployment.
4. Prove WorkOS-to-Convex authentication and the disabled-then-enabled deployed
   bidirectional Pika/Bara smoke before promoting the same contract version.

## Architecture plan

- Keep `pnpm build` local and side-effect free.
- Add a Vercel-only wrapper around the official `convex deploy --cmd` flow.
- Validate environment shape without printing configured values.
- Use distinct preview and production deploy-key types and WorkOS credentials.
- Document the separate Convex runtime-environment gate; Vercel variables do
  not by themselves prove the deployed functions have matching secrets.

## Risks

- A normal Next.js build can publish frontend code while leaving old Convex
  functions, schema, auth configuration, or crons in place.
- A production key in Preview can mutate production.
- A staging WorkOS API key in Production can cross environment boundaries.
- Logging preflight values can expose secrets.
- Deploying with the integration enabled before the round-trip smoke can create
  partial attendance behavior.

## Simplification

Do not add a second CI system, seed preview data automatically, or deploy from a
developer laptop. The existing Vercel pipeline remains the sole release entry.

## Acceptance criteria

- Local `pnpm build` never deploys Convex.
- Vercel builds fail closed outside Preview/Production or with mismatched key
  types, WorkOS credentials, callback origins, or cookie configuration.
- The rollout preflight reports only counts and failed check identifiers.
- Vercel invokes Convex's documented deploy command with
  `NEXT_PUBLIC_CONVEX_URL` bound to the deployment being published.
- Preview and production setup, smoke gates, rollback, and manual Convex
  environment checks are documented.

## Attendance credential smoke

Run `pnpm check:rollout` with `--mode pre-enable` while
`PIKA_ATTENDANCE_INTEGRATION=false`. This validates configuration shape without
requiring attendance enablement. The deployed Pika operator route then signs a
request to Bara's smoke-only endpoint; Bara signs a callback to Pika's
smoke-only ingress with the separate reverse secret. Both services consume
one-use nonces and enforce a five-attempt/15-minute scope limit. No attendance
domain row is created or changed.

No staging database exists. Preview must record a production-only skip and must
not contact production; that skip never satisfies the production promotion
gate. Production must pass both signed directions before enablement or canary
expansion. See `docs/system/pika-attendance-operational-recovery.md`.

## Read-only hosted audit — 2026-08-17

- Codepet Platform has separate Bara and Pika Applications in both Staging and
  Production. Codepet Labs remains a separate project and was not changed.
- Bara Vercel Preview currently reuses the local development Convex deployment,
  references an obsolete Preview callback, and lacks a Preview deploy key,
  canonical app origin, Bara cookie name, and integration variables. It is not
  an isolated rollout target.
- Pika Vercel Preview has no WorkOS or Bara integration variables and points at
  the only hosted Pika Supabase project. Do not deploy the unapplied attendance
  migration or enable attendance there.
- Pika Staging has an expiring application-scoped pilot key; Pika Production has
  no active API key. No production authentication rollout is possible by
  accident.
- WorkOS did not return its documented optional cross-application authorization
  code during a successful Pika Staging Magic Auth smoke. The no-prompt handoff
  remains disabled pending the provider's issuance conditions.

No hosted configuration changed during this audit. The next safe rollout step
requires both an isolated Pika Preview data target and confirmation of the
WorkOS cross-application exchange before creating deploy keys or writing Vercel
secrets.
