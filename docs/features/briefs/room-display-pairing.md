# Pair a room display with a short code

Open Bara’s `/display` page in Safari on an iPad or Chrome on an Android tablet. The page shows a code to enter for Room 223 in Pika’s Attendance rooms panel, or in the Rooms panel for a standalone Bara roster. The screen opens the assigned room automatically and remembers it when the same browser returns to `/display`.

Reuse the existing room display for student QR check-in, teacher moves and live announcements. Pairing replaces the selected room’s previous display. The setup code expires after five minutes. Only the display browser holds its long, randomly generated credential. Teachers enter the short code while signed in and authorized to manage the room. Bara claims the code and replaces the room credential in one transaction.

Acceptance

- A fresh browser shows an eight-character code. The selected room’s QR and existing notices appear after the teacher pairs it. New notices appear without reloading.
- Reloading the short address restores the assignment. A disconnected or replaced display loses access and can request a new code.
- An expired or consumed code cannot pair another room. The same teacher request can safely retry a successful claim. Signing in as a student or room non-manager cannot claim a code.
- Existing private room display links remain usable until the room is re-paired or disconnected. Attendance windows, roster matching and closed QR handling continue through the existing display.
- One network reaching its setup limit does not prevent another network from getting a code.

For a trial, lock the browser with iPad Guided Access or Android app pinning. School IT can configure supervised Single App Mode on iPad or a managed web kiosk on Android for dedicated devices.

Rollout: provision the same dedicated `BARA_DISPLAY_PAIRING_SECRET` in the target Bara web and Convex environments. Verify the live `/display` can issue and pair a code before promoting Pika. Older or unconfigured Bara deployments omit the pairing capability from their room list; Pika retains the private link flow.
