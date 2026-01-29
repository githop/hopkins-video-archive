interface SearchBarProps {
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  mode?: 'input' | 'display';
  disabled?: boolean;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  mode = 'input',
  disabled = false,
  placeholder = 'Find the video where dad drops the cake in the kitchen...',
}: SearchBarProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit && value.trim()) {
      onSubmit(value.trim());
    }
  };

  if (mode === 'display') {
    return (
      <div className="bg-background-input rounded-lg px-6 py-4 shadow-sm border border-border">
        <div className="flex items-center gap-3">
          <span className="text-text-muted">🔍</span>
          <span className="text-text-primary font-medium">{value}</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
          <span className="text-text-muted text-xl">🔍</span>
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-background-input rounded-lg pl-14 pr-6 py-5 text-lg text-text-primary placeholder:text-text-muted border border-border focus:outline-none focus:ring-2 focus:ring-action-primary/50 transition-all disabled:opacity-60"
        />
      </div>
      <div className="mt-4 flex justify-center">
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="px-8 py-3 bg-action-primary text-action-fg font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Search Archive
        </button>
      </div>
    </form>
  );
}
