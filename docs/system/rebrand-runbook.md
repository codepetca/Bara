# Rebrand Runbook

Use this checklist when the product name or public domain changes. Keep database identifiers, auth identifiers, and routes neutral unless a provider requires a branded display name.

## Application

1. Update `config/brand.ts`, moving the outgoing name into `formerNames`.
2. Replace `public/brand/mark.png` without changing its path.
3. Update current product and design documentation.
4. Update any visual snapshots affected by the new wordmark or mark.
5. Run `pnpm check:brand`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm test:visual`.

Do not rename Convex tables, document IDs, public routes, session tokens, or environment-variable keys for a cosmetic rebrand. Keep generated workspace names and slugs product-neutral.

## Repository And Local Checkouts

1. Rename the existing GitHub repository so its history, issues, pull requests, and settings stay attached.
2. Update local remotes with `git remote set-url origin <new-repository-url>`.
3. Do not reuse the former GitHub repository name; GitHub relies on that name to preserve redirects.
4. Move the hub checkout and recreate worktrees under the new documented paths after active worktrees are finished.
5. Recreate each worktree's `.env.local` symlink and install dependencies locally.

## Current Production Domain

- Bara's canonical origin is `https://bara.codepet.ca`. Cloudflare publishes a DNS-only CNAME for `bara` to Vercel. The existing Bara project serves it from the `production` branch. The `main` branch builds a separate Preview.
- In Bara's Vercel Production environment, `NEXT_PUBLIC_APP_URL=https://bara.codepet.ca` and `NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://bara.codepet.ca/callback`. WorkOS Codepet Platform Production uses that callback and `https://bara.codepet.ca/sign-in` for the Bara application, with `https://bara.codepet.ca` as its default sign-out destination.
- `https://bara-attendance.vercel.app` sends a 307 redirect to the corresponding path on `https://bara.codepet.ca`. Preserve link paths and query strings. Check browser handling of URL fragments before changing the redirect because older room display links carry pairing credentials there.
- Pika Production sets `BARA_ATTENDANCE_ROOM_DISPLAY_ORIGIN=https://bara.codepet.ca` for generated room display links. `BARA_ATTENDANCE_API_BASE_URL` targets the Convex HTTP deployment for signed attendance requests. Keep that server endpoint separate from Bara's web origin.

## Hosting And Domain Changes

1. Add the new custom domain to the existing Vercel project. Use the exact CNAME target Vercel provides and verify DNS and HTTPS.
2. Add the new callback and sign-out destination to the Bara application in WorkOS. Keep the former entries during the transition.
3. Check the origin guard on the deployed production branch before changing `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. Redeploy with both values set for the new domain.
4. Verify sign-in and sign-out, a public attendance or editor link, and the Pika attendance and room display flows. Test a paired display in a browser before replacing its old URL. Check sign-up, password reset, and invitations if the change affects their settings.
5. Change Pika's display origin and redeploy Pika so newly generated display links use the new domain.
6. Redirect the former web address to the new one. Test an old link with a path, query, and display pairing fragment. Remove former auth callbacks only after verification and a transition period.

Prefer renaming the existing Vercel and Convex project display names over creating new projects. Stable provider IDs, secrets, deployments, and stored data should remain in place.
