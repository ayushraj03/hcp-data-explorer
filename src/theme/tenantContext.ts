import { createContext, useContext } from "react";
import { TENANT_THEMES, type TenantTheme } from "./theme-config";

export const TENANT_KEYS = ["default", ...Object.keys(TENANT_THEMES)];

export interface ThemeContextValue {
  tenant: string;
  theme: TenantTheme;
  setTenant: (tenant: string) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTenantTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTenantTheme must be used within a ThemeProvider");
  return ctx;
}
