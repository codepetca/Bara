# Pika attendance entitlement deactivation

- User goal: let Pika authorize attendance per teacher while Bara remains an
  installation-scoped attendance engine with no billing knowledge.
- UX flow: none in Bara. Pika sends a higher-revision empty schedule when a
  classroom becomes ineligible.
- Primary action: cancel future scheduled occurrences without abandoning an
  already-open session or weakening installation, roster, or actor checks.
- Architecture plan: keep the v1 contract unchanged; codify that removal from
  a schedule snapshot cancels only scheduled occurrences, preserves open
  history, and lets the preserved open occurrence finalize normally.
- Risks: replaying stale schedule intent, cancelling historical/open state, or
  teaching Bara about Pika teacher IDs, plans, or payment state.
- Simplification: no Bara entitlement table, scoped flag, public API, or new
  message type. Pika owns admission and sends only existing opaque refs.
- Acceptance: a higher-revision empty schedule cancels future scheduled work,
  preserves an open session, and that open session still closes/finalizes at
  its authoritative close time; focused and full Bara checks pass.
