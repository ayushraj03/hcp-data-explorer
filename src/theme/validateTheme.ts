import { DEFAULT_THEME, type TenantTheme } from "./theme-config";

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isValidColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

function isValidAppName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 60;
}

function isValidRadius(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24;
}

/**
 * Resolves a (possibly malformed, possibly partial) tenant config into a
 * complete, safe TenantTheme — falling back to DEFAULT_THEME *per field*,
 * never discarding the whole config because one field is bad (FR-8).
 *
 * Tenant configs are untrusted input: wrapped defensively so a config that
 * throws on property access (e.g. a getter) can't crash the app either.
 */
export function resolveTheme(partial: Partial<TenantTheme> | undefined | null): TenantTheme {
  let p: Partial<TenantTheme>;
  try {
    p = partial ?? {};
  } catch {
    p = {};
  }

  const safe = (getter: () => unknown): unknown => {
    try {
      return getter();
    } catch {
      return undefined;
    }
  };

  return {
    appName: isValidAppName(safe(() => p.appName)) ? (p.appName as string) : DEFAULT_THEME.appName,
    primary: isValidColor(safe(() => p.primary)) ? (p.primary as string) : DEFAULT_THEME.primary,
    onPrimary: isValidColor(safe(() => p.onPrimary)) ? (p.onPrimary as string) : DEFAULT_THEME.onPrimary,
    background: isValidColor(safe(() => p.background)) ? (p.background as string) : DEFAULT_THEME.background,
    surface: isValidColor(safe(() => p.surface)) ? (p.surface as string) : DEFAULT_THEME.surface,
    text: isValidColor(safe(() => p.text)) ? (p.text as string) : DEFAULT_THEME.text,
    radius: isValidRadius(safe(() => p.radius)) ? (p.radius as number) : DEFAULT_THEME.radius,
  };
}
