import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap " +
  "transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg border-primary hover:bg-primary-hover hover:border-primary-hover",
  secondary: "bg-background text-foreground border-border hover:bg-surface-hover",
  danger: "bg-red-fg text-white border-red-fg hover:opacity-90",
  ghost: "bg-transparent text-foreground border-transparent hover:bg-surface-hover",
};

// lg is the default tap target on phones (48 px).
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", full = false) {
  return cn(base, variants[variant], sizes[size], full && "w-full");
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize; full?: boolean };

export function Button({ variant = "secondary", size = "md", full, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cn(buttonClasses(variant, size, full), className)} {...rest} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; full?: boolean };

export function ButtonLink({ variant = "secondary", size = "md", full, className, ...rest }: ButtonLinkProps) {
  return <Link className={cn(buttonClasses(variant, size, full), className)} {...rest} />;
}
