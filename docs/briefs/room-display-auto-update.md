# Room display updates

Paired displays pick up new Bara deployments unattended. Keep the active QR available while any class in that room is accepting scans. Compare the running version to the current version on the same origin every 15 minutes while check-in is closed. Recheck the room immediately before reloading.

Read Vercel’s deployment ID in the display page and in a small, uncached endpoint. Use the existing room query and credential for the final check. Keep the page open during connection or version-check failures, retry in the background, and rate-limit repeat reloads for the same update within the tab. The browser reloads its current address and keeps the pairing stored on the device.

Send a device report immediately on launch, then every 15 minutes. Return the interval from Convex so devices running older pages adopt the slower heartbeat too.

Verify the same version, open and closed check-in, reopened check-in during the check, failures and cooldown, and a browser reload after closing check-in. Older tabs need one page refresh after the updater first ships.
