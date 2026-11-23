# Native Bara Display pilot

Run the existing Bara room display in a full-screen iPad app on the supervised Room 223 tablet. Use Apple Configurator for Single App Mode. Keep the room assignment through a reboot and use the existing live attendance state to control the backlight.

The iPad-only app targets iPadOS 16. It loads `https://bara.codepet.ca/display` in a persistent WebKit data store. Bara sends a `closed` message only when its current connected room query confirms that no window is accepting attendance. It sends `readable` when check-in opens or the result is uncertain. The native handler accepts those two messages only from the expected display document. Pairing, attendance, QR updates, and deployment refreshes use the existing display page.

## Build and install

Open `ios/BaraDisplay.xcodeproj` and select the `BaraDisplay` scheme. If editing the project settings, regenerate it from `ios/project.yml` with XcodeGen. An unsigned device build checks arm64 and the iPadOS 16 deployment target.

```bash
~/.local/bin/devq submit --source codex -- xcodebuild -project ios/BaraDisplay.xcodeproj -scheme BaraDisplay -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

For the physical pilot, use an iOS development build or an exported IPA with a provisioning profile that includes the pilot iPad. Enable Developer Mode for a development-signed app. Xcode 27 cannot debug iPadOS 16 directly. Install the signed app with Apple Configurator. The live Bara site needs the display-state bridge before the native brightness test.

## Room 223 test

1. Open Bara Display and scan its setup code from the phone. Register it under PETHS without a room. The app uses its own saved pairing.
2. With check-in closed, assign the existing Safari display to **No room**, then assign the new app to **223**. Keep the Safari registration available to reverse the transfer.
3. In Apple Configurator, select the iPad and choose **Actions → Advanced → Start Single App Mode → Bara Display**. Verify Home leaves Bara Display visible.
4. Restart the device from Configurator and watch for Room 223 and its QR to return. Check for an unlock or a new pairing prompt and record what happened.
5. In a designated test class, open, close, and reopen check-in in Room 223. Confirm the QR and backlight follow each transition. Verify the open QR from the normal scanning position.
6. Disconnect Wi-Fi and check that the display stays readable. Reconnect and confirm the QR and backlight recover. Outside Single App Mode, leave the app while check-in is closed, open check-in, then return to the app. Confirm it reads the current state and restores system brightness when leaving again.

To move the pilot back, stop Single App Mode, set the native display to **No room** in Bara, assign the existing Safari display to **223**, and select Safari in Configurator again.
