import { useLayoutEffect, useState } from 'react';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
};

const STORAGE_KEY = 'sentinel-theme';

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isTheme(saved)) return saved;
    // The Neon theme was retired; people who had chosen it get Dark.
    if (saved === 'neon') return 'dark';
  } catch {
    // Storage can be blocked (private windows, strict settings); use the system preference instead.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Preference simply won't persist when storage is unavailable.
    }
  }, [theme]);

  const cycleTheme = () => setTheme((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
  return { theme, cycleTheme };
}
