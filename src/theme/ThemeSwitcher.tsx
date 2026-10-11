import { TENANT_KEYS, useTenantTheme } from "./tenantContext";
import { TENANT_THEMES } from "./theme-config";

function labelFor(key: string): string {
  if (key === "default") return "Default (HCP Data Explorer)";
  const name = TENANT_THEMES[key]?.appName;
  return name && typeof name === "string" ? name : key;
}

export function ThemeSwitcher() {
  const { tenant, setTenant } = useTenantTheme();
  return (
    <label className="tenant-switcher">
      <span className="tenant-switcher__label">Tenant</span>
      <select value={tenant} onChange={(e) => setTenant(e.target.value)} aria-label="Switch tenant theme">
        {TENANT_KEYS.map((key) => (
          <option key={key} value={key}>
            {labelFor(key)}
          </option>
        ))}
      </select>
    </label>
  );
}
