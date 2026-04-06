"use client";

type PresentTotalPillProps = {
  presentCount: number;
  totalCount: number;
  className?: string;
};

export function PresentTotalPill({
  presentCount,
  totalCount,
  className,
}: PresentTotalPillProps) {
  return (
    <div
      aria-label={`${presentCount} of ${totalCount} students marked present`}
      className={`inline-flex h-11 shrink-0 items-stretch overflow-hidden rounded-full ring-1 ring-[var(--color-border-default)] shadow-sm ${className ?? ""}`.trim()}
    >
      <span className="flex min-w-16 items-center justify-center bg-[var(--color-success-soft)] px-4 text-lg font-semibold leading-none text-[var(--color-success)]">
        {presentCount}
      </span>
      <span className="flex min-w-16 items-center justify-center border-l border-[var(--color-border-default)] bg-[var(--color-surface-muted)] px-4 text-lg font-semibold leading-none text-[var(--color-text-muted)]">
        {totalCount}
      </span>
    </div>
  );
}
