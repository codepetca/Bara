# Bara

Realtime mobile attendance for teachers taking attendance at the classroom door.

This repository is the canonical Bara application. Earlier platform-specific implementations remain available as legacy repositories: `bara-flutter`, `bara-swift`, `bara-server`, `bara-server-old`, and `bara-collab`.

## Stack

- Next.js 16 App Router
- TypeScript
- Convex for database, mutations, and live queries
- WorkOS AuthKit for authentication
- Tailwind CSS 4

## Auth model

- WorkOS AuthKit handles sign-in, sign-up, session management, and configured identity providers
- Bara keeps internal `app_users` and `auth_identities` tables
- Convex stores canonical organizations, memberships, and roster access
- Rosters are organization-owned and access is granted through `roster_access`
- Dashboard and roster management routes require authentication
- Session editor token routes such as `/s/edit/[token]` stay public

## Features

- Roster list and roster detail pages
- Organization-scoped roster access
- CSV import flow with:
  - file upload
  - column mapping for name and student ID
  - parsed preview before import
  - duplicate student ID warnings
- Demo roster seeding for quick testing
- Attendance sessions created from a roster
- One session editor link per roster session for live attendance updates
- Mobile-first editor screen with:
  - full-row tap targets
  - search
  - hide-present toggle
  - split sections for `Not Yet Marked` and `Present`

## Project structure

```text
app/
  sign-in/route.ts                   WorkOS sign-in redirect
  sign-up/route.ts                   WorkOS sign-up redirect
  callback/route.ts                  WorkOS authentication callback
  page.tsx                           roster list
  rosters/import/page.tsx            CSV import
  rosters/[rosterId]/page.tsx        roster detail
  s/edit/[token]/page.tsx            live editor screen
components/
  auth-header-controls.tsx
  roster-import-form.tsx
  session-attendance-screen.tsx
  use-current-app-user.ts
config/
  brand.ts                           product name and current brand copy
convex/
  appUsers.ts
  auth.config.ts
  auth.ts
  attendance.ts
  rosters.ts
  schema.ts
  sessions.ts
lib/
  students.ts                        CSV parsing + normalization rules
  demo-data.ts
  session-links.ts
public/
  brand/mark.png                    replaceable brand mark at a stable URL
```

## Rebranding

Application source reads the current product identity from `config/brand.ts`, and brand artwork uses the stable `public/brand/` path. Run `pnpm check:brand` to catch product-name literals added outside the central configuration. Follow `docs/system/rebrand-runbook.md` when changing the brand or canonical domain.

## Data model

### `app_users`

- `displayName`
- `status`
- `defaultOrganizationId`
- `createdAt`
- `updatedAt`

### `auth_identities`

- `appUserId`
- `provider`
- `providerSubject`
- `tokenIdentifier`
- `emailSnapshot`
- `nameSnapshot`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

### `organizations`

- `name`
- `slug`
- `status`
- `createdAt`
- `updatedAt`

### `organization_memberships`

- `appUserId`
- `organizationId`
- `role`
- `status`
- `createdAt`
- `updatedAt`

### `roster_access`

- `rosterId`
- `membershipId`
- `accessRole`
- `createdAt`
- `updatedAt`

### `rosters`

- `organizationId`
- `createdByAppUserId`
- `name`
- `createdAt`
- `updatedAt`

### `participants`

- `rosterId`
- `linkedAppUserId`
- `externalId`
- `rawName`
- `firstName`
- `lastName`
- `displayName`
- `sortKey`
- `participantType`
- `active`
- `createdAt`
- `updatedAt`

### `sessions`

- `rosterId`
- `title`
- `date`
- `sessionType`
- `participantMode`
- `isOpen`
- `createdByAppUserId`
- `editorToken`
- `openedAt`
- `closedAt`
- `createdAt`
- `updatedAt`

### `attendance_records`

- `sessionId`
- `participantId`
- `linkedAppUserId`
- `status`
- `source`
- `markedAt`
- `modifiedAt`
- `modifiedByAppUserId`

This app uses one attendance record per participant per session.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure WorkOS AuthKit and Convex

Start Convex development once and follow the CLI prompts to create or select a deployment:

```bash
pnpm convex:dev
```

Add these values to `.env.local` if the CLIs do not write them for you:

```bash
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_APP_URL=http://localhost:3000
WORKOS_CLIENT_ID=client_your_client_id
WORKOS_API_KEY=sk_test_your_api_key
WORKOS_COOKIE_PASSWORD=at_least_32_random_characters
WORKOS_COOKIE_NAME=bara-wos-session
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
```

You can use [.env.local.example](./.env.local.example) as a starting point.

Codepet Platform is the WorkOS project shared by the related products, but Pika
and Bara retain separate AuthKit Applications in each environment. That gives
each product its own client, credentials, redirects, session policy, and token
audience while the environment still shares the WorkOS user directory. Keep
Codepet Labs in its separate WorkOS project. Configure Bara explicitly rather
than enabling Convex-managed AuthKit provisioning.
In each WorkOS environment:

1. Add Bara's exact callback, allowed origins, and sign-out targets to the Bara
   Application for that environment. Configure Pika on its own Application.
   When the apps run together locally, use one host consistently.
   Bara allows `127.0.0.1` as an additional Next.js development origin. If a
   different local hostname is required, add it to `NEXT_ALLOWED_DEV_ORIGINS`.
   Otherwise Next.js 16 can serve the HTML while blocking its client runtime,
   leaving AuthKit token loading and Convex authentication stuck indefinitely.
2. Set the environment JWT template to
   `{"aud":"{{ application.client_id }}"}`. This makes every application token's
   audience equal its own client ID instead of hard-coding Pika or Bara.
3. Set the Bara Application's `WORKOS_CLIENT_ID` in the matching Convex
   deployment, then run `pnpm convex:dev` (development) or deploy that release
   (preview/production) to sync `convex/auth.config.ts`.

`convex/auth.config.ts` validates WorkOS's environment issuer and `aud`, while
Bara's authorization boundary also requires the JWT `client_id` claim to match
the same value. Bara independently maps and authorizes the verified subject
using local IDs. Pika's separate Application does the same in Pika. Use distinct
WorkOS development and production environments; never deploy an `sk_test_` key
to production.

Bara emits a nonce-based Content Security Policy on every routed response.
Scripts are limited to the request nonce and the application runtime; browser
connections are limited to Bara and the exact origins derived from
`NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`. WorkOS API calls stay
server-side. Development additionally permits React debugging evaluation and
loopback WebSockets; production does not. Keep those Convex variables exact in
every deployment because the CSP intentionally fails closed when an endpoint
is not configured.

The app auth routes are `/sign-in`, `/sign-up`, and `/callback`. The callback URL must match `NEXT_PUBLIC_WORKOS_REDIRECT_URI` and the WorkOS environment configuration.
Bara uses its own environment-specific `WORKOS_COOKIE_NAME` and
`WORKOS_COOKIE_PASSWORD`; it does not decrypt Pika's cookie or receive Pika's
refresh token. The no-prompt Pika journey uses WorkOS's cross-application
authorization-code exchange to create a Bara-scoped session. Keep
`WORKOS_COOKIE_DOMAIN` unset.

### 2a. Configure Vercel and Convex deployment

Vercel must publish the matching Convex backend and Next.js frontend as one
release. `vercel.json` therefore invokes the guarded `pnpm build:vercel`
command. That wrapper runs Convex's documented deployment flow:

```bash
pnpm exec convex deploy \
  --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL \
  --cmd "pnpm build"
```

Keep `pnpm build` as the local, side-effect-free frontend build. Never run
`pnpm build:vercel` from a developer shell; it fails unless Vercel identifies
the build as Preview or Production.

Configure these values separately in Vercel Preview and Production:

- `CONVEX_DEPLOY_KEY`: a Convex **Preview deploy key** in Preview and a
  least-privilege **Production deploy key** with `deployment:deploy` in
  Production.
- `WORKOS_CLIENT_ID` and `WORKOS_API_KEY`: staging (`sk_test_`) credentials in
  Preview and live (`sk_live_`) credentials in Production.
- `WORKOS_COOKIE_PASSWORD`: at least 32 random characters, distinct per
  environment.
- `WORKOS_COOKIE_NAME=bara-wos-session` in Bara; Pika uses its own cookie name.
- `NEXT_PUBLIC_APP_URL`: the exact canonical HTTPS Bara origin for that build.
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`: that exact origin plus `/callback`.

The guarded build rejects a mismatched deploy-key type, WorkOS environment,
origin, callback, or cookie configuration before calling Convex. It prints
failed check identifiers only, never configured values.

WorkOS redirect, homepage, sign-out, CORS, and JWT-template settings are managed
explicitly in the matching Codepet Platform environment. Record and verify the
exact Preview and Production URLs before a release. If Bara later uses a
different canonical custom domain, update WorkOS and the guarded origin rule in
the same release before changing `NEXT_PUBLIC_APP_URL`.

Vercel variables and Convex runtime variables are separate. Before enabling a
target, inspect the matching Convex deployment and confirm its
`WORKOS_CLIENT_ID` equals the Vercel client ID. When the Pika integration is
enabled, the same Convex deployment must also contain the exact
`PIKA_ATTENDANCE_INTEGRATION`, `PIKA_INTEGRATION_REF`,
`PIKA_INTEGRATION_SECRET`, `PIKA_EVENT_DELIVERY_URL`, and
`PIKA_EVENT_DELIVERY_SECRET` values. Do not infer this from a successful
frontend build.

This follows the current [Convex Vercel deployment
guide](https://docs.convex.dev/production/hosting/vercel), [deploy-key
guidance](https://docs.convex.dev/cli/deploy-key-types), and [Convex's standard
WorkOS team setup](https://docs.convex.dev/auth/authkit/#option-2-use-an-existing-workos-team).

### 3. Run the app

In one terminal:

```bash
pnpm convex:dev
```

In another terminal:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

### First sign-in

1. Open `/sign-up`.
2. Create a WorkOS AuthKit account.
3. Return to the dashboard and confirm the app creates your internal user, default organization, and membership.
4. Open another browser profile or incognito window with a different account to verify the first roster is hidden there.

### CSV import

1. Sign in and go to `Import roster`.
2. Upload the exported CSV.
3. Choose the name column and student ID column.
4. Review the preview.
5. Fix any duplicate student IDs before importing.
6. Create the roster.

## Name parsing rules

- Preserve the original imported name in `rawName`
- If the raw name contains a comma, split on the first comma
- Left side becomes `lastName`
- Right side becomes `firstName`
- `displayName` becomes `First Last`
- `sortKey` sorts by last name, then first name

## Validation

```bash
pnpm lint
pnpm test
pnpm test:visual
pnpm typecheck
pnpm build
```

Before activating Pika attendance in a target, load only that target's
environment and run the aggregate preflight:

```bash
pnpm check:rollout -- \
  --stage preview \
  --expected-bara-origin "https://exact-bara-preview-origin.example" \
  --expected-pika-origin "https://exact-pika-preview-origin.example"
```

The preflight requires the legacy browser handoff to remain disabled, the
server-to-server attendance adapter to be enabled, the exact event-ingress
path, scoped credentials, and three distinct secrets. Its output
contains only counts and failed check identifiers. It does not verify hosted
database migrations, network reachability, or the Convex runtime environment;
perform those gates separately before enabling a pilot classroom.

### Release order and rollback

1. Deploy Preview with both Pika integration flags disabled.
2. Confirm WorkOS callback completion and that Convex reaches authenticated
   state with exactly one internal identity link.
3. Apply the additive Pika migration only to the verified non-production
   database, configure both sides, run `pnpm check:rollout`, then enable the
   flags for a bounded smoke classroom.
4. Prove roster, schedule, automatic open/close, teacher mark/correction,
   event projection, reconciliation, and native Pika student QR behavior.
5. Promote only the tested contract version and repeat the preflight with live
   production credentials.

Rollback is flag-first: disable Pika's attendance surface and Bara's
`PIKA_ATTENDANCE_INTEGRATION`, preserving the audit/outbox data for diagnosis.
Then redeploy the last known-good frontend and Convex commit together. Never
roll back only one side across a breaking contract version.

## Visual Design Evidence

Use Playwright screenshot tests to verify that UI changes still match the guidance in `DESIGN.md`.

```bash
pnpm test:visual
```

Notes:

- The visual suite runs against test-only routes under `/visual-test/*`.
- Those routes are enabled only while Playwright starts the dev server with `ENABLE_VISUAL_TEST_ROUTES=1`.
- The fixtures are deterministic, so snapshot diffs show visual drift instead of data drift.
- Update baselines intentionally with:

```bash
pnpm test:visual --update-snapshots
```

## Manual smoke test

Use this after resetting the dev deployment or changing auth/bootstrap logic.

1. Start Convex and Next.js:

```bash
pnpm convex:dev
pnpm dev
```

2. Open `http://localhost:3000` in a fresh browser profile or incognito window.
3. Sign up or sign in through the WorkOS Hosted UI.
4. Confirm you land on the dashboard without a bootstrap error.
5. In another terminal, verify the canonical identity rows exist:

```bash
npx convex data app_users --limit 5 --format pretty
npx convex data organizations --limit 5 --format pretty
npx convex data organization_memberships --limit 5 --format pretty
```

6. Create a roster and confirm it appears in the dashboard.
7. Verify the roster created the expected access row:

```bash
npx convex data rosters --limit 5 --format pretty
npx convex data roster_access --limit 5 --format pretty
```

8. Open the roster, start a session, and confirm the editor link loads.
9. Mark one participant present and verify attendance was written:

```bash
npx convex data attendance_records --limit 10 --format pretty
```

10. Open a second browser profile with a different WorkOS account and confirm the first roster is not visible there.

### Student QR callback gate

Run this with the matching WorkOS and Convex environment before every auth-sensitive production release:

1. Open a valid session and prepare a second WorkOS account with an active student organization membership that uniquely matches a participant in that roster.
2. Copy that session's `/check-in/<token>` URL and open it while the student browser profile is signed out.
3. Complete WorkOS Hosted UI authentication and confirm `/callback` returns the browser to the exact same `/check-in/<token>` URL, not the dashboard or `/`.
4. Wait for Convex authentication and bootstrap to finish, then confirm the page reports that the matched student is present.
5. Verify the resulting `attendance_records` row is `present`, has `source: "student_qr"`, and is linked to the student's app user:

```bash
npx convex data attendance_records --limit 10 --format pretty
```

Do not promote the release if the callback loses the token route, Convex never reaches an authenticated state, the student is rejected despite a valid active membership, or the attendance record is missing.

### Local same-client session experiment

The local Codepet Platform smoke passed on 2026-08-17: a passcode login in Pika
opened Bara on the same host without a second login, Bara resolved the WorkOS
session and access token, and `useConvexAuth()` reached authenticated state.
Repeated Bara reloads did not add duplicate `app_users` or `auth_identities`
rows. The development deployment still contains three linked identities from
the intentionally repeated multi-account tests; that historical test data is
not a bootstrap failure. This experiment is fallback evidence only; the
production design uses separate Pika and Bara Applications and the no-prompt
cross-application authorization-code exchange.

## AI Workflow

- Start with [docs/system/app-dna.md](docs/system/app-dna.md) and [docs/system/product-principles.md](docs/system/product-principles.md) for product and UI guardrails.
- Use [docs/system/testing-strategy.md](docs/system/testing-strategy.md) to decide what test surface and validation are expected for a change.
- Use [docs/workflow/feature-brief.md](docs/workflow/feature-brief.md) before non-trivial feature work.
- Use [docs/workflow/post-implementation-review.md](docs/workflow/post-implementation-review.md) after meaningful feature work.
- Reuse [docs/system/ui-patterns.md](docs/system/ui-patterns.md), [docs/system/anti-patterns.md](docs/system/anti-patterns.md), and [docs/system/screen-review-rubric.md](docs/system/screen-review-rubric.md) instead of inventing new rules each time.
- When a workflow repeats, follow [docs/system/skill-creation.md](docs/system/skill-creation.md): suggest a skill, ask for approval, then create it only if it is justified.

## Notes

- Dashboard access requires WorkOS authentication.
- Authorization lives in Convex, not in WorkOS role claims.
- Public session editing still relies on unguessable editor tokens.
- Invalid share links show a friendly invalid-link state.
- The app renders a setup screen until `NEXT_PUBLIC_CONVEX_URL` is configured.
