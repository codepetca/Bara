import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "outline" | "danger" | "warning";
type ButtonSize = "sm" | "md";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return cn(
    "inline-flex items-center justify-center rounded-full font-medium transition disabled:cursor-not-allowed",
    size === "sm" ? "h-10 px-4 text-sm" : "h-11 px-4 text-sm",
    variant === "primary" &&
      "bg-[var(--color-action)] text-white hover:bg-[var(--color-action-hover)] disabled:bg-slate-300",
    variant === "outline" &&
      "border border-[var(--color-border-default)] bg-[var(--color-surface)] text-slate-700 hover:border-slate-400 hover:text-slate-950 disabled:border-slate-200 disabled:text-slate-400",
    variant === "danger" &&
      "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-hover)] disabled:bg-rose-200",
    variant === "warning" &&
      "bg-[var(--color-warning)] text-white hover:bg-[var(--color-warning-hover)] disabled:bg-amber-200 disabled:text-amber-700",
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
