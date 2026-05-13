# Attendance Creation Wizard

- User goal: start attendance from the dashboard without thinking in “roster import” terms first.
- UX flow: dashboard `Create Attendance` -> choose `Single` or `Recurring` -> add students and title -> preview parsed roster -> create attendance -> land on roster management.
- Primary action: create attendance for a class in one pass on mobile.
- Architecture plan: add `/attendance/create`, reuse `RosterImportForm` with a wizard variant, keep `/rosters/import` for low-level roster editing, and keep `/rosters/[rosterId]` as the management surface.
- Risks: duplicating import logic, weakening the roster mental model, or making recurring settings feel like a second workflow instead of a setting.
- Simplification pass: no draft persistence, no new backend entity, no change to student flows, no change to existing roster edit path.
- Acceptance criteria: dashboard CTA changes, wizard creates both single and recurring classes without saving drafts, creation still lands on roster detail, and roster settings can switch between one-off and recurring without touching attendance history.
