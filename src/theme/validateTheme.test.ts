import { describe, expect, it } from "vitest";
import { resolveTheme } from "./validateTheme";
import { DEFAULT_THEME, TENANT_THEMES } from "./theme-config";

describe("resolveTheme", () => {
  it("returns DEFAULT_THEME untouched when given undefined (no tenant config)", () => {
    expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
  });

  it("accepts a fully valid tenant config as-is", () => {
    const resolved = resolveTheme(TENANT_THEMES.aurelia);
    expect(resolved.appName).toBe("Aurelia Field IQ");
    expect(resolved.primary).toBe("#0B5FA5");
    expect(resolved.radius).toBe(8);
  });

  it("falls back per-field for an invalid hex color, without discarding the rest of the config", () => {
    // meridian.primary is the deliberately malformed "#ZZ8800"
    const resolved = resolveTheme(TENANT_THEMES.meridian);
    expect(resolved.primary).toBe(DEFAULT_THEME.primary); // falls back
    expect(resolved.appName).toBe("Meridian 360"); // still honored
    expect(resolved.surface).toBe("#F4F4F4"); // still honored
  });

  it("falls back per-field for a non-numeric radius", () => {
    // meridian.radius is the deliberately malformed "huge"
    const resolved = resolveTheme(TENANT_THEMES.meridian);
    expect(resolved.radius).toBe(DEFAULT_THEME.radius);
  });

  it("falls back for fields missing from a partial config", () => {
    const resolved = resolveTheme(TENANT_THEMES.meridian);
    expect(resolved.onPrimary).toBe(DEFAULT_THEME.onPrimary);
    expect(resolved.text).toBe(DEFAULT_THEME.text);
  });

  it("rejects an out-of-range radius", () => {
    expect(resolveTheme({ radius: 999 }).radius).toBe(DEFAULT_THEME.radius);
    expect(resolveTheme({ radius: -1 }).radius).toBe(DEFAULT_THEME.radius);
  });

  it("rejects an empty appName", () => {
    expect(resolveTheme({ appName: "" }).appName).toBe(DEFAULT_THEME.appName);
  });

  it("never throws on a hostile config object", () => {
    const hostile = {
      get primary(): string {
        throw new Error("boom");
      },
    } as unknown as Partial<typeof DEFAULT_THEME>;
    expect(() => resolveTheme(hostile)).not.toThrow();
    expect(resolveTheme(hostile).primary).toBe(DEFAULT_THEME.primary);
  });
});
