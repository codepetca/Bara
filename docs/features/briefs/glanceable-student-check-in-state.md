## Glanceable Student Check-In State

- User goal: let a teacher glance at a student's device after a QR scan and immediately confirm whether attendance was recorded.
- UX flow: student scans QR, the result fills the screen, and the teacher can read the outcome, name, and student ID from a distance.
- Primary action: confirm attendance success instantly.
- Architecture plan: extend the QR check-in mutation result with student identity when available, restyle `components/student-check-in-screen.tsx` into a full-screen result mode, update the visual fixture, and add a focused component test.
- Risks: making the result too decorative could clash with the rest of the app; keep the message large and simple while preserving invalid-link and loading states.
- Simplification pass: only the post-scan result becomes full-screen; pending and invalid-link states keep the quieter card pattern.
- Acceptance criteria: success fills the screen with a green confirmation, large checkmark, student name, and student ID; non-success results are equally obvious with warning or error color; tests cover the changed result contract.
