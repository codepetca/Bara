# WorkOS Magic Auth email delivery

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
worker intentionally stops retries after ten minutes and before fewer than two
useful minutes remain on the WorkOS challenge. It handles one claimed row at a
time, disables WorkOS SDK retries, and renews the lease immediately before the
bounded Brevo request. The template receives a conservative whole-minute
remaining lifetime rather than always claiming ten minutes. Ambiguous late
failures are marked failed; the user must request a fresh code. Completed
metadata is removed after 30 days, and expired pending metadata after 24 hours.

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
