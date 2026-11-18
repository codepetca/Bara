# Printed room attendance QR

Give a Bara room one reusable student poster, modeled on Pika’s printed class posters. An organization admin chooses **Displays → Edit rooms → Student QR** and enables the poster for the room. The poster can be printed, replaced, or turned off. Staff can print it with the tablet offline or unassigned.

Use a separate random room key and the deployment’s canonical URL for the poster. After sign-in, capture the current room windows in the existing short-lived scan and bind it to the signed-in room member. Keep the existing enrollment checks, per-window cutoffs, and retry protection. Reject an earlier poster and its pending scans after it is replaced or disabled. Keeping a copy of the poster allows a future scan while a class is accepting attendance, so all rooms start with the poster off.

Try it with room 223. Scan one printed poster into two matching open classes with one student account. Verify it counts only eligible classes, works again for a later window, and reports closed between windows. Confirm the same poster works without a paired display and that replacing it leaves the display’s live QR valid.
