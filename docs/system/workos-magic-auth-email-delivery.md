# WorkOS Magic Auth email delivery

## Production status

Production cutover completed on 2026-08-24. WorkOS default Magic Auth email
delivery is disabled for the shared Production environment, Pika continues its
direct Brevo delivery, and Bara's Brevo worker is enabled. Fresh Pika and
standalone Bara challenges each produced one message and completed the correct
application login.

Closeout evidence, recorded without recipient addresses or codes:

- the production WorkOS webhook is enabled for one event and points to Bara's
  production Convex endpoint;
- the two production Bara canary challenges created two distinct outbox rows,
  both `delivered`, each with `attemptCount=1` and no error code;
- Brevo recorded matching `Sent` and `Delivered` events with no visible bounce,
  block, or failure;
- WorkOS recorded successful Magic Auth and session-creation events; and
- the isolated delivery-path canary proved duplicate webhook replay returns
  `duplicate` without another Brevo attempt, while a Pika application event is
  acknowledged as `ignored_pika_application` without creating a Bara row.

There is no production-like staging database. The WorkOS Staging plus Bara
Convex development canary proves the delivery path, filtering, and idempotency;
the complete application-login gate must be performed as a controlled
production canary.

## Decision

Keep Pika and Bara as separate WorkOS Applications in the same environment.
Pika continues its direct WorkOS-code-to-Brevo send. Bara owns the environment's
`magic_auth.created` webhook and sends only Bara challenges through Brevo. After
both flows pass canaries, disable WorkOS's environment-wide default Magic Auth
email so each challenge has one sender.

This is email routing only. It does not create sessions, exchange identities, or
change the Pika-to-Bara attendance boundary. Standalone Bara login still ends in
a Bara WorkOS session. Native Pika attendance still uses Pika authentication and
the signed server-to-server actor assertion.

## Runtime design

`POST /api/webhooks/workos` verifies the `WorkOS-Signature` against the exact raw
body with the WorkOS SDK. When delivery is enabled it routes by
`context.client_id`:

- Bara client ID: enqueue the event and schedule delivery.
- Pika client ID: acknowledge without enqueueing; Pika already sends directly.
- Any other client ID or event type: acknowledge without sending.

The durable outbox is unique by WorkOS event ID. It stores event/object IDs,
client ID, expiration, status, and a random Brevo idempotency UUID. It never
stores the recipient address or Magic Auth code. The worker retrieves the code
from WorkOS only when it is ready to send.

Brevo receives the stable UUID in its provider-specific
`headers.idempotencyKey` field. Brevo currently documents a 30-minute TTL; this
worker intentionally stops retries after ten minutes and unless at least four
minutes remain on the WorkOS challenge. Two minutes are reserved for Brevo and
mailbox latency, leaving at least two conservative whole minutes for the
recipient. It handles one claimed row at a time, disables WorkOS SDK retries,
and renews the lease immediately before the bounded Brevo request. The template
receives that conservative lifetime rather than always claiming ten minutes.
Ambiguous late failures are marked failed; the user must request a fresh code.
Completed metadata is removed after 30 days, and expired pending metadata after
24 hours.

## Required Convex environment variables

Configure these separately in each Bara Convex deployment. Do not copy values
between staging and production.

```text
WORKOS_MAGIC_AUTH_BREVO_DELIVERY=false
WORKOS_MAGIC_AUTH_WEBHOOK_SECRET=<matching WorkOS endpoint secret>
WORKOS_API_KEY=<matching WorkOS environment API key>
WORKOS_CLIENT_ID=<Bara application client ID>
PIKA_WORKOS_CLIENT_ID=<Pika application client ID in the same environment>
BREVO_API_KEY=<transactional send key>
BREVO_TEMPLATE_ID=<approved Magic Auth template>
BREVO_FROM_EMAIL=<verified CodePet sender>
BREVO_FROM_NAME=Bara
```

The template contract is `code`, conservative whole minutes remaining in
`expires`, and `type=magic_auth`. The endpoint URL is the deployment's Convex
site URL plus `/api/webhooks/workos`. Subscribe only to `magic_auth.created`.

## Rollout gates

No default-delivery setting changes until the code is deployed with the feature
flag off.

1. Deploy schema, endpoint, outbox, worker, and cron with
   `WORKOS_MAGIC_AUTH_BREVO_DELIVERY=false`.
2. Configure the deployment variables and create the signed WorkOS webhook for
   `magic_auth.created`. Confirm WorkOS receives `200` with delivery disabled.
3. Confirm the Brevo sender/domain and template are approved and tracking does
   not expose the code.
4. In an isolated staging environment with no live Pika traffic, enable Bara
   delivery while WorkOS default delivery remains on. Request one standalone
   Bara challenge. Two messages are expected only for this isolated canary; the
   Brevo message proves the custom path before the fallback is removed. Confirm
   one delivered outbox row and one Brevo API send. Repeat the same Brevo
   request with its stable idempotency UUID and confirm `duplicate_parameter`,
   one provider send, and one Brevo mailbox message.
5. Disable WorkOS default Magic Auth emails in that environment.
6. Request fresh challenges, one at a time, for Pika and standalone Bara. For
   each challenge confirm exactly one mailbox message, exactly one Brevo send,
   a successful code exchange, and the correct application session. Confirm a
   Pika event creates no Bara outbox row.
7. For production, do not run a pre-cutover email canary in the shared live
   environment. During a staffed window, first confirm Pika is in direct-Brevo
   mode and the staging gates passed. Enable Bara delivery and immediately
   disable WorkOS default Magic Auth delivery as one controlled change. The
   existing Pika duplicate state persists only until the second setting is
   applied. Then run the Pika, standalone Bara, school-board, and external
   mailbox verification from step 6.

Also test an approved school-board mailbox, a normal external mailbox, duplicate
delivery of the same signed webhook, an invalid signature, and a Brevo transient
failure. Do not use a real user's challenge for failure testing.

## Rollback

If either login flow fails, re-enable WorkOS default Magic Auth email first so
standalone Bara regains a sender. Then set
`WORKOS_MAGIC_AUTH_BREVO_DELIVERY=false`. Pika may temporarily return to two
messages during rollback, but authentication remains available. Leave the
webhook registered and code dormant while diagnosing, or remove the endpoint
only after its feature flag is off.

Never replay a failed row after its retry window; request a fresh challenge.
Never copy codes or recipient addresses into logs or incident notes.

## Steady-state monitoring

Review these signals after an auth incident, deployment, credential rotation,
or reported delivery problem:

1. WorkOS Production keeps default Magic Auth email delivery disabled and the
   Bara webhook enabled for only `magic_auth.created`.
2. Bara Production keeps `WORKOS_MAGIC_AUTH_BREVO_DELIVERY=true`. Repeated
   worker attempts, accumulating pending rows, or failed rows require
   investigation, but `attemptCount>1` alone does not prove duplicate mail:
   safe WorkOS retrieval and Brevo retries can increase it.
3. Brevo shows one provider-accepted message per stable idempotency key, with
   `Sent` followed by `Delivered`. Correlate the outbox idempotency key with the
   provider events before declaring a duplicate. Check suppressions, bounces,
   blocks, and credential/rate-limit errors before retrying.
4. WorkOS records the expected Magic Auth success and session for the
   application that initiated the challenge. Email delivery does not prove the
   correct application session by itself.

Do not replay an authentication challenge to diagnose delivery. Create a fresh
challenge, test one application at a time, and never record the recipient or
code in durable logs. Retain outbox metadata for the existing cleanup window so
delivery attempts remain auditable without retaining message contents.

## Onboarding another CodePet service

Every new service remains a separate WorkOS Application with its own callback,
session, client ID, and application-scoped API key. Before enabling Magic Auth
for that application:

1. Choose exactly one owner for the service's email. Prefer direct Brevo
   delivery when the service already owns the WorkOS-generated code. Otherwise,
   give the service an isolated signed worker with its matching
   application-scoped WorkOS key and sender/template configuration. Never use
   Bara's API key to retrieve another application's Magic Auth object.
2. Keep the WorkOS environment-wide default disabled. Deploy and configure a
   new application's custom path disabled-by-default, prove it outside
   production, then enable it before the first live production challenge.
3. Use separate Staging and Production credentials. Never copy webhook secrets,
   WorkOS API keys, or Brevo keys between environments.
4. Add tests for signature failure, client-ID filtering, event-ID
   deduplication, provider idempotency, expiry, retries, credential/configuration
   selection, and the rule that other CodePet applications cannot enqueue the
   service's mail. Tests must prove each client ID selects only its matching
   application key and sender configuration without exposing either value.
5. Run a delivery-path canary outside production, then a staffed production
   canary proving one provider send, one mailbox message, successful code
   exchange, and the correct application session. Keep the rollback sequence
   below ready.

Do not broaden Bara into a generic mail bus for a third service by default. If
three or more services need webhook-owned delivery, extract the same signed,
allowlisted, idempotent contract into a dedicated bridge with an explicit
client-ID-to-application-credential-and-sender map, service ownership, and
monitoring. Keep credentials isolated in storage and selection; do not share
sessions or use one application's API key for another application.

## Rejected alternatives

- WorkOS-only delivery is simplest but has already failed the school-board
  deliverability requirement.
- A WorkOS-supported environment-level email provider would be preferable if an
  approved provider can meet delivery requirements, but Brevo is not a native
  preset and migration would require a new deliverability canary.
- A shared cross-service mail bridge is unnecessary operational surface for two
  applications; Bara's small worker can later be extracted without changing the
  event contract.
- A separate WorkOS project/environment would isolate email settings, but adds
  keys, webhooks, domains, monitoring, and onboarding overhead without being
  required for the current separate-Application identity boundary.

References: [WorkOS custom emails](https://workos.com/docs/authkit/custom-emails),
[WorkOS webhooks](https://workos.com/docs/events/data-syncing/webhooks), and
[Brevo transactional email API](https://developers.brevo.com/reference/send-transac-email).
