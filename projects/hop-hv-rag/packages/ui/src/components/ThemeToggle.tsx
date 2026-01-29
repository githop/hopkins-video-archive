import { useState } from 'react';

export function ThemeToggle() {
  // Initialize from OS setting only once
  const [theme, setTheme] = useState<'lotus' | 'dragon'>(() => {
    const systemTheme =
      typeof window === 'undefined'
        ? 'lotus'
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dragon'
          : 'lotus';

    // Apply initial theme immediately
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-mode', systemTheme);
    }

    return systemTheme;
  });

  const toggleTheme = () => {
    const newTheme = theme === 'lotus' ? 'dragon' : 'lotus';
    setTheme(newTheme);
    // Apply directly in callback - no effect needed
    document.documentElement.setAttribute('data-mode', newTheme);
  };

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      aria-label={`Switch to ${theme === 'lotus' ? 'dragon' : 'lotus'} theme`}
    >
      <span className="text-xs uppercase tracking-wide">Current Theme:</span>
      <span className="font-semibold">
        {theme === 'lotus' ? 'LOTUS' : 'DRAGON'}
      </span>
      <span className="text-lg" aria-hidden="true">
        {theme === 'lotus' ? '☀️' : '🌙'}
      </span>
    </button>
  );
}
