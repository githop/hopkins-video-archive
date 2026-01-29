import { ThemeToggle } from './ThemeToggle';

export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-background-surface border-b border-border">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-action-primary flex items-center justify-center">
            <span className="text-action-fg font-bold text-sm">🎬</span>
          </div>
          <h1 className="font-serif text-xl font-semibold text-text-primary tracking-tight">
            Hopkins Family Video Archive
          </h1>
        </div>

        {/* Controls - just theme toggle */}
        <div className="flex items-center gap-6">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
