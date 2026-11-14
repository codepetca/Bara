# Managed room display pilot

An unregistered tablet opens `/display` and shows a coloured setup QR and a short code. An administrator scans the QR with a phone, registers the display to a school, and either chooses a room or leaves it unassigned. Administrators can assign a room later from Displays.

Bara stores the display separately from the room. Its browser retains the existing display credential and receives assignment changes while open. A room can have one active display. The pilot rejects an occupied room and lets administrators disconnect or move the current display first. Existing private links and room codes continue to work.

After the receiver reconnects, the fleet page shows when it last reported and when the current display page started. The pilot passes when school IT restarts a supervised iPad from its management console and the same room and scannable QR return without a tap, unlock, or new pairing code. An unassigned display should also return to its waiting screen after restart.
