# Tapcheck

Realtime mobile attendance for teachers taking attendance at the classroom door.

## Stack

- Next.js 16 App Router
- TypeScript
- Convex for database, mutations, and live queries
- WorkOS AuthKit for authentication
- Tailwind CSS 4

## Auth model

- WorkOS AuthKit handles sign-in, sign-up, hosted auth, and session management
- Tapcheck keeps internal `app_users` and `auth_identities` tables
- Convex stores canonical organizations, memberships, and roster access
- Rosters are organization-owned and access is granted through `roster_access`
- Provider identities can link to existing internal users by verified email when the match is unique
- QR check-in can provision a student membership from a unique verified roster email match
- Dashboard and roster management routes require authentication
- Session editor token routes such as `/s/edit/[token]` stay public
- WorkOS is the shared identity direction for Tapcheck, Pika, Repocat, and future CodePet apps; Tapcheck should not depend on a separate `codepet-auth` service

## Features

- Roster list and roster detail pages
- Organization-scoped roster access
- CSV import flow with:
  - file upload
  - column mapping for name and student ID
  - parsed preview before import
  - duplicate student ID warnings
- Demo roster and QR smoke-test seeding for quick testing
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
  callback/route.ts                  WorkOS callback
  page.tsx                           roster list
  rosters/import/page.tsx            CSV import
  rosters/[rosterId]/page.tsx        roster detail
  s/edit/[token]/page.tsx            live editor screen
components/
  auth-shell.tsx
  auth-header-controls.tsx
  roster-import-form.tsx
  session-attendance-screen.tsx
  use-current-app-user.ts
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
```

## QR smoke-test seed data

Tapcheck can seed a creator-owned roster plus one student identity placeholder for end-to-end QR testing. WorkOS remains the external auth provider; the seed creates Tapcheck internal data that later links to a real WorkOS student sign-in by verified email.

Enable the seed mutation only on the dev Convex deployment:

```bash
npx convex env set TAPCHECK_ENABLE_SEED_DATA true
```

Run the seed mutation with a teacher identity and the student email you will use in WorkOS:

```bash
TAPCHECK_SEED_TEACHER_EMAIL=teacher@example.com \
TAPCHECK_SEED_STUDENT_EMAIL=student@example.edu \
pnpm seed:smoke
```

Then sign in through WorkOS as `student@example.edu` and scan the seeded roster QR. Tapcheck will attach the real WorkOS identity to the seeded internal `app_user` by verified email.

Disable the seed mutation when done:

```bash
npx convex env remove TAPCHECK_ENABLE_SEED_DATA
```

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
- `issuer`
- `emailSnapshot`
- `emailVerifiedSnapshot`
- `nameSnapshot`
- `linkMethod`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

### `organizations`

- `name`
- `slug`
- `status`
- `createdAt`
- `updatedAt`

### `organization_external_links`

- `organizationId`
- `provider`
- `externalOrganizationId`
- `externalOrganizationName`
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
WORKOS_CLIENT_ID=client_your_client_id
WORKOS_API_KEY=sk_test_your_api_key
WORKOS_COOKIE_PASSWORD=at-least-32-characters-random-secret
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
```

You can use [.env.local.example](./.env.local.example) as a starting point.

Set `WORKOS_CLIENT_ID` in the Convex deployment environment as well so Convex can validate WorkOS-issued JWTs.
The app auth routes are `/sign-in`, `/sign-up`, and `/callback`.
Tapcheck derives the WorkOS callback URL from the active request origin, so local auth can work on any registered dev port.
`convex.json` keeps WorkOS AuthKit redirects and CORS origins configured for common local ports when `npx convex dev` runs.
If you use ports `3000` through `3004`, add these redirect URIs in the WorkOS dashboard:

```text
http://localhost:3000/callback
http://localhost:3001/callback
http://localhost:3002/callback
http://localhost:3003/callback
http://localhost:3004/callback
```

For local sign-out redirects, allow the matching origins as well:

```text
http://localhost:3000
http://localhost:3001
http://localhost:3002
http://localhost:3003
http://localhost:3004
```

If local WorkOS values are missing, Tapcheck redirects to `/setup/workos` instead of throwing an AuthKit 500.

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
2. Create or authenticate with a WorkOS AuthKit account.
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
3. Sign up or sign in through WorkOS AuthKit.
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
