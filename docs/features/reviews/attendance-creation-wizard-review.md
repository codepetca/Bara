# Attendance Creation Wizard Review

- What improved: the dashboard now starts from attendance intent, creation is shorter on mobile, and roster management keeps schedule settings separate from roster editing.
- What stayed stable: creation still uses the existing roster mutations, students still only see session flows, and `Edit Roster` remains the path for changing the student list.
- Smoke readiness: the wizard is now a two-step flow, with parsed roster preview and `Create Attendance` shown immediately after students are loaded.
- Follow-up candidates:
  - decide whether roster cards need a faster one-off shortcut later
  - complete authenticated browser smoke testing from a signed-in teacher browser before broad beta rollout
