import { useSyncExternalStore, useCallback } from 'react';

// Get current system theme
function getSystemTheme(): 'lotus' | 'dragon' {
  if (typeof window === 'undefined') return 'lotus';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dragon'
    : 'lotus';
}

// Subscribe to system theme changes
function subscribeThemeChange(callback: () => void): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

export function ThemeToggle() {
  // Track system theme reactively
  const systemTheme = useSyncExternalStore<'lotus' | 'dragon'>(
    subscribeThemeChange,
    getSystemTheme,
    () => 'lotus', // Server snapshot
  );

  // Apply theme to document whenever it changes
  const applyTheme = useCallback((theme: 'lotus' | 'dragon') => {
    document.documentElement.setAttribute('data-mode', theme);
  }, []);

  // Apply current system theme
  applyTheme(systemTheme);

  const getCurrentTheme = (): 'lotus' | 'dragon' => {
    const mode = document.documentElement.getAttribute('data-mode');
    return mode === 'dragon' ? 'dragon' : 'lotus';
  };

  const toggleTheme = () => {
    const current = getCurrentTheme();
    const newTheme = current === 'lotus' ? 'dragon' : 'lotus';
    applyTheme(newTheme);
  };

  const currentTheme = getCurrentTheme();

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      aria-label={`Switch to ${currentTheme === 'lotus' ? 'dragon' : 'lotus'} theme`}
    >
      <span className="text-xs uppercase tracking-wide">Current Theme:</span>
      <span className="font-semibold">
        {currentTheme === 'lotus' ? 'LOTUS' : 'DRAGON'}
      </span>
      <span className="text-lg" aria-hidden="true">
        {currentTheme === 'lotus' ? '☀️' : '🌙'}
      </span>
    </button>
  );
}
