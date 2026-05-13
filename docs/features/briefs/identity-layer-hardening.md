# Identity Layer Hardening

## User Goal

Make Tapcheck's Convex identity layer stronger for Tapcheck now and reusable across Pika, Repocat, and future SaaS apps.

## Architecture Plan

- Preserve internal `app_users` + `auth_identities` ownership.
- Add verified-email account linking so future provider migrations can preserve app users safely.
- Prefer explicit configured provider issuer mapping over heuristic provider inference.
- Allow QR check-in to provision student membership from a unique roster email match.
- Add external organization-link storage for future Pika/school/org mapping.

## Risks

- Email-based linking must require verified email claims.
- QR self-provisioning must only happen on a unique active participant email match.
- External organization links are storage only in this pass; Pika sync still needs a dedicated integration flow.

## Acceptance Criteria

- Existing auth bootstrap and roster authorization tests still pass.
- A new provider identity with a verified email can link to an existing app user.
- A signed-in student with verified email can check in when roster email matches, even before an explicit membership exists.
- Ambiguous or unverified cases remain blocked/review-needed.
