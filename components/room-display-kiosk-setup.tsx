export function RoomDisplayKioskSetup() {
  return (
    <details className="text-sm text-slate-700">
      <summary className="cursor-pointer py-2">Set up tablet kiosk mode</summary>
      <div className="space-y-4 py-2">
        <section className="space-y-1">
          <h3 className="font-medium">iPad with Guided Access</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>In Settings → Accessibility → Guided Access, turn it on and set a passcode only staff know. Set Display Auto-Lock to Never.</li>
            <li>Open the paired display on the iPad. Triple-click the Top button, or the Home button on models that have one.</li>
            <li>In Guided Access, open Session Settings (or Options), disable the Top or Home button, leave Touch on, and tap Start.</li>
          </ol>
          <p>To exit, use the Guided Access shortcut again and enter the passcode.</p>
          <a href="https://support.apple.com/en-ca/111795" target="_blank" rel="noreferrer" className="inline-block underline">Apple’s Guided Access instructions</a>
        </section>
        <section className="space-y-1">
          <h3 className="font-medium">Android with a school-managed tablet</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Ask school IT to enroll the tablet as an Android Enterprise dedicated device.</li>
            <li>Have IT set the Bara display URL as the start page of a managed web app, make it the single kiosk app, and include Chrome.</li>
            <li>Open the kiosk app. If it shows a pairing code, enter that code in Rooms. Have IT disable Home and Recents and block the power menu.</li>
          </ol>
          <a href="https://developers.google.com/android/management/policies/dedicated-devices#enable_kiosk_mode_for_web_pages" target="_blank" rel="noreferrer" className="inline-block underline">Google’s Android kiosk instructions</a>
        </section>
      </div>
    </details>
  );
}
