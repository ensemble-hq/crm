import { useCallback, useEffect, useState } from 'react';

export type ColorMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'crm-color-mode';
const ORDER: ColorMode[] = ['auto', 'light', 'dark'];

function stored(): ColorMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    // Storage can be blocked (private windows); follow the system then.
    return 'auto';
  }
}

/**
 * The page's colour mode: follow the system, or force light or dark. The choice is kept in this
 * browser. `index.html` applies it before the first paint, so there is no flash on load.
 */
export function useColorMode(): { mode: ColorMode; cycle: () => void } {
  const [mode, setMode] = useState<ColorMode>(stored);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    try {
      if (mode === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Not saved; the choice still holds until the page reloads.
    }
  }, [mode]);

  const cycle = useCallback(() => setMode((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'auto'), []);
  return { mode, cycle };
}
