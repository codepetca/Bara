# Rebrand Runbook

Use this checklist whenever the product name changes. Keep domain names, database identifiers, auth identifiers, and routes neutral unless a provider requires a branded display name.

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

## Hosting And Domain

1. Add the new custom domain to the existing hosting project before removing the former domain.
2. Add the new production callback and redirect URLs to every active auth provider.
3. Update `NEXT_PUBLIC_APP_URL` and any provider-specific public redirect variables.
4. Deploy and verify sign-in, sign-up, sign-out, password reset, invitations, copied editor links, copied display links, and public attendance tokens.
5. Redirect the former custom domain to the new canonical domain.
6. Remove former auth callbacks only after production verification and an appropriate transition period.

Prefer renaming the existing Vercel and Convex project display names over creating new projects. Stable provider IDs, secrets, deployments, and stored data should remain in place.
