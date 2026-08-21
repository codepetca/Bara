"use client";

import Link from "next/link";
import { Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";

type VisualSplitLinkActionProps = {
  href: string;
  label: string;
  copyLabel: string;
  trailingIcon?: React.ReactNode;
};

export function VisualSplitLinkAction({
  href,
  label,
  copyLabel,
  trailingIcon,
}: VisualSplitLinkActionProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const absoluteUrl = new URL(href, window.location.origin).toString();
    await navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex min-w-0">
      <Link
        href={href}
        className={buttonVariants({
          variant: "primary",
          className:
            "h-14 min-w-0 flex-1 justify-center rounded-r-none bg-slate-800 px-4 text-center hover:bg-slate-700",
        })}
      >
        <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
        {trailingIcon}
      </Link>
      <button
        type="button"
        aria-label={copyLabel}
        onClick={() => void handleCopy()}
        className={buttonVariants({
          variant: "primary",
          className:
            "h-14 w-14 shrink-0 rounded-l-none border-l border-slate-700 bg-slate-700 px-0 hover:bg-slate-600",
        })}
      >
        {copied ? <span className="text-xs font-semibold">OK</span> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
