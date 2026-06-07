/**
 * TenantThemeProvider — injects tenant brand colours as CSS variables.
 *
 * Wrap any tenant- or candidate-facing subtree with this; descendants
 * can then use `text-[color:var(--tenant-primary)]` /
 * `bg-[color:var(--tenant-primary)]` / `[--tw-ring-color:var(--tenant-primary)]`
 * etc. via Tailwind arbitrary values, or read the variables directly
 * from custom CSS.
 *
 * Server Component: no interactivity, just renders a wrapper <div>
 * with style props inlined. Cheap; safe to nest.
 */

import type { CSSProperties, ReactNode } from "react";

import { brandToCssVars, type TenantBrand } from "@/lib/tenant/branding";

export function TenantThemeProvider({
  brand,
  className,
  children,
}: {
  brand: TenantBrand;
  className?: string;
  children: ReactNode;
}) {
  const vars = brandToCssVars(brand) as unknown as CSSProperties;
  return (
    <div style={vars} className={className}>
      {children}
    </div>
  );
}
