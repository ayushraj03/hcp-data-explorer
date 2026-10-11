import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TENANT_THEMES, type TenantTheme } from "./theme-config";
import { resolveTheme } from "./validateTheme";
import { TENANT_KEYS, ThemeContext } from "./tenantContext";

function readTenantFromUrl(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const tenant = params.get("tenant");
    return tenant && TENANT_KEYS.includes(tenant) ? tenant : "default";
  } catch {
    return "default";
  }
}

function applyCssVars(theme: TenantTheme) {
  const root = document.documentElement.style;
  root.setProperty("--color-primary", theme.primary);
  root.setProperty("--color-on-primary", theme.onPrimary);
  root.setProperty("--color-background", theme.background);
  root.setProperty("--color-surface", theme.surface);
  root.setProperty("--color-text", theme.text);
  root.setProperty("--radius", `${theme.radius}px`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenantState] = useState<string>(readTenantFromUrl);

  // Tenant config is untrusted (FR-8): resolveTheme falls back per-field,
  // so a malformed entry (bad hex, non-numeric radius, missing field) can
  // never crash rendering or leave a field undefined.
  const theme = useMemo(() => resolveTheme(tenant === "default" ? undefined : TENANT_THEMES[tenant]), [tenant]);

  useEffect(() => {
    applyCssVars(theme);
    document.title = theme.appName;
  }, [theme]);

  const setTenant = (next: string) => {
    const safeNext = TENANT_KEYS.includes(next) ? next : "default";
    setTenantState(safeNext);
    try {
      const url = new URL(window.location.href);
      if (safeNext === "default") url.searchParams.delete("tenant");
      else url.searchParams.set("tenant", safeNext);
      window.history.replaceState({}, "", url);
    } catch {
      /* URL API unavailable or blocked — tenant still switches in-memory */
    }
  };

  return <ThemeContext.Provider value={{ tenant, theme, setTenant }}>{children}</ThemeContext.Provider>;
}
