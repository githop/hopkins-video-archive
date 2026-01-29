import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  onNewSearch?: () => void;
}

export function Header({ onNewSearch }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-background-surface border-b border-border">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-action-primary flex items-center justify-center">
            <span className="text-action-fg font-bold text-sm">🎬</span>
          </div>
          <h1 className="font-serif text-xl font-semibold text-text-primary tracking-tight">
            HOPKINS ARCHIVE
          </h1>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6">
          {onNewSearch && (
            <button
              onClick={onNewSearch}
              className="text-sm text-text-secondary hover:text-text-primary transition-colors flex items-center gap-2"
            >
              <span>↻</span>
              New Search
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
