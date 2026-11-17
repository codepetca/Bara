"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { getConfiguredAppOrigin } from "@/lib/session-links";

export type StudentPosterAction = "enable" | "replace" | "disable";

export function RoomStudentPoster({ label, roomId, posterKey, busy, onChange }: {
  label: string;
  roomId: string;
  posterKey: string | null;
  busy: boolean;
  onChange: (action: StudentPosterAction) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState<"replace" | "disable" | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const url = posterKey ? new URL(
    `/rooms/${encodeURIComponent(roomId)}/scan`,
    getConfiguredAppOrigin() ?? window.location.origin,
  ) : null;
  if (url && posterKey) url.searchParams.set("poster", posterKey);

  useEffect(() => {
    (confirmation ? cancel.current : heading.current)?.focus();
  }, [confirmation]);

  useEffect(() => {
    function clearPrintState() { delete document.body.dataset.printRoomPoster; }
    window.addEventListener("afterprint", clearPrintState);
    return () => {
      window.removeEventListener("afterprint", clearPrintState);
      clearPrintState();
    };
  }, []);

  function printPoster() {
    document.body.dataset.printRoomPoster = "true";
    window.print();
  }

  return (
    <section className="space-y-4" aria-label={`${label} student QR`}>
      <h3 ref={heading} tabIndex={-1} className="font-heading text-lg font-semibold">{label} student QR</h3>
      {url ? (
        <>
          <div className="mx-auto w-full max-w-44 bg-white p-4">
            <QRCode value={url.href} aria-label={`Student attendance QR for ${label}`} className="h-auto w-full" />
          </div>
          {confirmation ? (
            <>
              <p className="text-sm" role="alert">The current printed QR will stop working.</p>
              <div className="flex flex-wrap gap-2">
                <Button ref={cancel} variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
                <Button variant="danger" disabled={busy} onClick={() => {
                  const action = confirmation;
                  setConfirmation(null);
                  void onChange(action);
                }}>{confirmation === "replace" ? "Replace printed QR" : "Turn off printed QR"}</Button>
              </div>
            </>
          ) : (
            <>
              <Button className="w-full" disabled={busy} onClick={printPoster}>Print poster</Button>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmation("replace")}>Replace QR</Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmation("disable")}>Turn off</Button>
              </div>
            </>
          )}
          {createPortal(
            <div data-room-poster-print aria-hidden="true" className="hidden flex-col items-center justify-center gap-10 bg-white text-center text-black">
              <p className="font-heading text-6xl font-semibold">{label}</p>
              <div className="w-[4in] p-5"><QRCode value={url.href} className="h-auto w-full" /></div>
              <p className="font-heading text-3xl font-semibold">Scan to check in</p>
            </div>,
            document.body,
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-text-muted">Anyone with a copy can scan it during an open attendance window.</p>
          <Button className="w-full" disabled={busy} onClick={() => void onChange("enable")}>Enable student QR</Button>
        </>
      )}
    </section>
  );
}
