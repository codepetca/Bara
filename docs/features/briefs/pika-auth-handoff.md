# Pika authentication handoff

Status: superseded for native Pika attendance by the server-to-server actor
assertion model in `bara-attendance-engine-boundary.md`. The disabled browser
handoff code remains historical work and is not a dependency of the target
architecture.

- User goal: sign into Pika once and enter Bara attendance without another
  email, passcode, or hosted-login prompt.
- UX flow: Pika verifies Magic Auth under the Pika WorkOS Application. WorkOS
  returns a single-use cross-application authorization code; Bara exchanges it
  under the Bara Application, creates its own session, and resolves the
  identity locally without another user prompt.
- Primary action: the existing Pika sign-in action; Bara adds no new user action.
- Architecture plan: keep separate WorkOS Applications and sessions, use the
  provider's one-time cross-application exchange, then preserve Convex's
  `app_users` + `auth_identities` bootstrap and all app-local roles.
- Risks: WorkOS code issuance or entitlement drift, logout/rotation drift,
  environment mixing, wrong token audience, the short-lived browser-readable
  eager-auth token, and presenting a second login when exchange fails.
- Simplification: keep the handoff disabled until WorkOS confirms why Staging
  Magic Auth omitted the documented optional code. The same-client/shared-cookie
  local proof remains fallback evidence, not the production architecture.
- Acceptance: one Pika login; direct protected Bara access without another
  prompt; Convex authenticated; one identity link; exact return path; mismatch
  fails closed; logout is defined; no shared internal IDs, databases, or roles.
- Security gate completed locally: Bara now emits a per-request nonce CSP,
  limits browser connections to the configured Convex origins, blocks framing
  and inline event handlers, and removes the development evaluation exception
  in production. Preview must preserve and re-smoke that policy.
