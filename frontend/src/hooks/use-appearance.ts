import { useCallback, useEffect, useMemo, useState } from "react";

export type Appearance = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "appearance";
const LEGACY_THEME_KEY = "theme";

function isAppearance(value: string | null): value is Appearance {
  return value === "light" || value === "dark" || value === "system";
}

/** Reads the stored preference, migrating the legacy binary "theme" key. */
function readStoredAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isAppearance(stored)) return stored;
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === "dark" || legacy === "light") return legacy;
  } catch {
    // ignore storage errors
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(appearance: Appearance): ResolvedTheme {
  if (appearance === "system") return systemPrefersDark() ? "dark" : "light";
  return appearance;
}

function applyThemeClass(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

/**
 * Three-way appearance control (Light / Dark / System).
 *
 * The resolved theme is applied as a `dark` class on <html> so Tailwind's
 * class-based dark variant works, and system preference changes are followed
 * live while "system" is selected. The preference is persisted to localStorage.
 */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => readStoredAppearance());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readStoredAppearance()));

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      setResolvedTheme(resolveTheme(appearance));
      applyThemeClass(resolveTheme(appearance));
    };

    update();

    if (appearance === "system") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
  }, [appearance]);

  const setAppearanceAndPersist = useCallback((next: Appearance) => {
    setAppearance(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  return useMemo(
    () => ({
      appearance,
      setAppearance: setAppearanceAndPersist,
      resolvedTheme,
    }),
    [appearance, resolvedTheme, setAppearanceAndPersist],
  );
}
