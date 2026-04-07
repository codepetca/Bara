# Recurring Attendance Modes

- User goal: let a teacher run attendance either as a one-off Tapcheck workflow or as a recurring class workflow, while keeping room for future Pika-linked classes.
- UX flow: open a roster, see whether it is standalone or linked, optionally configure a recurring schedule, and have attendance auto-open on class days without changing the existing session screens.
- Primary action: open or manage attendance for the current class day quickly.
- Architecture plan: extend Convex schema with roster mode, standalone schedule, operational class-day rows, and external-link plumbing; add schedule automation and expose schedule state on the roster detail page; preserve current session and QR routes.
- Risks: automated open/close could duplicate sessions, scheduled data could interfere with one-off attendance, and linked-mode scaffolding could accidentally block current local roster workflows.
- Simplification pass: implement full standalone recurring support now; add linked-mode data plumbing without pretending Pika sync is complete in this repo.
- Acceptance criteria: standalone rosters still support one-off attendance; standalone rosters can define a recurring schedule and auto-open/auto-close sessions; roster detail clearly shows schedule state; linked-mode metadata exists without breaking current attendance flows.
