"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open, busy]);

  return (
    <Dialog open={open} onClose={onCancel} closeDisabled={busy} labelledBy={titleId}>
      <Card
        variant="default"
        className="w-full border border-white/70 bg-white shadow-xl ring-0"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const from = event.shiftKey ? cancel.current : confirm.current;
          const to = event.shiftKey ? confirm.current : cancel.current;
          if (event.target === from || busy) {
            event.preventDefault();
            if (!busy) to?.focus();
          }
        }}
      >
        <h2
          id={titleId}
          className="font-heading text-xl font-semibold tracking-tight text-slate-950"
        >
          {title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
        {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button
            ref={cancel}
            variant="outline"
            onClick={busy ? undefined : onCancel}
            aria-disabled={busy}
            className="w-full"
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirm}
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
            className="w-full"
          >
            {busy ? "Working..." : confirmLabel}
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}
