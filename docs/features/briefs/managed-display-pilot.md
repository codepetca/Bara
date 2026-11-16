# Managed room display pilot

An unregistered tablet opens `/display` and shows a coloured setup QR and a short code. An administrator scans the QR with a phone, registers the display to a school, and either chooses a room or leaves it unassigned. Administrators can assign a room later from Displays.

Bara stores the display separately from the room. Its browser retains the existing display credential and receives assignment changes while open. A room can have one active display. The pilot rejects an occupied room and lets administrators disconnect or move the current display first. Existing private links and room codes continue to work.

The fleet page shows when Bara last heard from the display and when it received the current page's launch report.

## Hardware check

1. Use an HTTPS pilot deployment with short-code pairing configured on both the web and Convex sides. Give the managed kiosk browser `/display` as its startup URL and keep its website data across restarts.
2. In a standalone Bara roster, create an unused test room. Scan the iPad's setup QR with a phone, sign in as an organization admin, and register it without a room. Check that the iPad shows **Waiting for room assignment**.
3. In **Manage displays**, assign the test room and confirm the iPad switches to its room QR. Note the launch report time.
4. Restart the supervised iPad from the school's device management console. Confirm that the same room and scannable QR return without a tap, unlock, or new pairing code, and that **Launch reported** advances. Record which step failed if the iPad requires intervention.
