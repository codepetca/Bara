# Identity Layer Hardening Review

## Review

- The app still owns domain identity through `app_users`; provider identity stays in `auth_identities`.
- Verified-email linking gives a production migration path without trusting unverified provider claims.
- QR self-provisioning is intentionally narrow: verified auth email plus one active roster email match.
- External organization links are schema-only in this pass, which is appropriate because Pika sync needs a dedicated integration contract.

## Follow-Ups

- Configure WorkOS JWTs to include `email` and `email_verified` so QR self-provisioning can work reliably.
- When Pika integration starts, create a sync mutation that writes `organization_external_links`, student memberships, and roster participants together.
- Add an admin/staff UI later for resolving ambiguous identity and roster matches.
