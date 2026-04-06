import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

type CardVariant = "default" | "subtle" | "success" | "danger";
type CardElement = "section" | "div" | "header";

type CardProps = ComponentPropsWithoutRef<"section"> & {
  as?: CardElement;
  variant?: CardVariant;
};

export function Card({
  as = "section",
  variant = "default",
  className,
  ...props
}: CardProps) {
  const Comp = as;

  return (
    <Comp
      className={cn(
        "rounded-[28px] p-5 shadow-sm",
        variant === "default" &&
          "border bg-[var(--color-surface)] ring-1 border-[var(--color-border-subtle)] ring-[var(--color-ring-subtle)]",
        variant === "subtle" && "border border-[var(--color-border-default)] bg-[var(--color-surface-muted)]",
        variant === "success" && "border border-emerald-200 bg-[var(--color-surface-success)]",
        variant === "danger" && "border border-rose-200 bg-[var(--color-surface-danger)]",
        className,
      )}
      {...props}
    />
  );
}
