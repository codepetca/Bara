# Managed room display pilot

An unregistered tablet opens `/display` and shows a coloured setup QR and a short code. An administrator scans the QR with a phone, registers the display to a school, and can select a room, add a room, or leave the display unassigned. Administrators can add or assign a room later from Displays.

Creating a room from display setup works before the school has a roster. The registration or assignment mutation creates and assigns the standalone room in one transaction, using the same school-wide room naming rules as roster settings. An expired code or an occupied room leaves the display and room records intact.

On a registered display, **Edit rooms** opens a phone-friendly editor for the workspace room list. Adding a room there assigns it to the display only when it has no room. Selecting a room on the display card saves immediately. Removing a room hides it from future selections, unassigns its display, and preserves attendance history. Close or move an open class before removing its room.

The default display name combines the selected device type and the last four characters of its setup code, such as **iPad 7K2M**. The administrator can enter an asset tag or another name when registering, or edit the name and device type later from the display card. Keep launch and heartbeat data for verification while keeping routine device details out of the phone's display list. Editing a display preserves its registration and room assignment.

Bara stores the display separately from the room. Its browser retains the existing display credential and receives assignment changes while open. A room can have one active display. The pilot rejects an occupied room and lets administrators disconnect or move the current display first. Existing private links and room codes continue to work.

The fleet page shows when Bara last heard from the display and when it received the current page's launch report.

## Hardware check

1. Use an HTTPS pilot deployment with short-code pairing configured on both the web and Convex sides. Give the managed kiosk browser `/display` as its startup URL and keep its website data across restarts.
2. Scan the iPad's setup QR with a phone and sign in as an organization admin. Choose **Add a room**, enter a room name, and register the display. Alternatively, register it without a room and check that the iPad shows **Waiting for room assignment**. Then use **Add a room** and **Save room** in Displays.
3. Confirm the iPad switches to its room QR. Note the launch report time in Displays.
4. Restart the supervised iPad from the school's device management console. Confirm that the same room and scannable QR return without a tap, unlock, or new pairing code, and that **Launch reported** advances. Record which step failed if the iPad requires intervention.
