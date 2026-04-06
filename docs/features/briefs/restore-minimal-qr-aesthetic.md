## Restore Minimal QR Aesthetic

- User goal: keep the QR attendance flow, but make it feel like the quieter pre-QR Tapcheck UI.
- UX flow: open a session, search or mark attendance quickly, use QR tools as secondary support, and let students see a calm check-in screen.
- Primary action: mark attendance fast from the live session screen.
- Architecture plan: restyle `components/session-attendance-screen.tsx`, `components/session-display-screen.tsx`, `components/student-check-in-screen.tsx`, and align `components/copy-button.tsx`; extend the nearest attendance screen test.
- Risks: reducing visual weight too far could hide QR utilities or important review states; keep review and closed-session states legible.
- Simplification pass: remove decorative tinting, reduce duplicate badges, keep metadata brief, and group QR tools into one quieter support section.
- Acceptance criteria: session, display, and student check-in screens use the same calm card language as the rest of the app; QR flow and manual attendance still work; nearby tests cover the changed UI contract.
