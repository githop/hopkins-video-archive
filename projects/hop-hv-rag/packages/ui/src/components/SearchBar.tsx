interface SearchBarProps {
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  showSuggestions?: boolean;
}

// All curated suggestion queries based on real archive data (20 total)
const ALL_SUGGESTIONS = [
  // Person-focused (4)
  {
    label: 'Grandpa fishing',
    query: 'Show me videos fishing at Lake Cumberland',
  },
  {
    label: 'Grandma birthdays',
    query: 'Find birthday celebrations with Grandma',
  },
  { label: 'Geoff Christmas', query: 'What Christmas videos feature Geoff?' },
  {
    label: 'Family at beach',
    query: 'Show me scenes of the family at the beach',
  },

  // Activity-focused (4)
  { label: '1990s fishing', query: 'Find fishing trips from the 1990s' },
  { label: 'Football games', query: 'Show me football games and practices' },
  {
    label: 'Swimming memories',
    query: 'What swimming pool memories do we have?',
  },
  { label: 'Boat trips', query: 'Find our family boat trips' },

  // Location-focused (4)
  {
    label: 'Hopkins Home',
    query: 'Show me videos taken at the Hopkins Family Home',
  },
  {
    label: "Grandma's House",
    query: "Find scenes from Christmas at Grandma's House",
  },
  { label: 'Lake Cumberland', query: 'What happened at Lake Cumberland?' },
  { label: 'Backyard parties', query: 'Show me backyard birthday parties' },

  // Time-focused (4)
  { label: 'Early 2000s', query: 'Find videos from the early 2000s' },
  { label: '1990s videos', query: 'What do we have from the 1990s?' },
  { label: 'Oldest videos', query: 'Show me the oldest family videos' },
  { label: 'Recent 2020-2021', query: 'Find recent videos from 2020-2021' },

  // Combined (4)
  { label: 'Dad & Geoff fishing', query: 'Find Dad teaching Geoff to fish' },
  {
    label: "Karen's parties",
    query: "Show me Karen's birthday parties at home",
  },
  {
    label: 'Christmas mornings',
    query: 'What Christmas mornings are on video?',
  },
  {
    label: 'Backyard football',
    query: 'Find football practice in the backyard',
  },
];

// Fisher-Yates shuffle algorithm
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Randomly select 3 suggestions at module level (outside render)
const SUGGESTIONS = shuffle(ALL_SUGGESTIONS).slice(0, 3);

export function SearchBar({
  value,
  onChange,
  onSubmit,
  disabled = false,
  showSuggestions = true,
}: SearchBarProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit && value.trim()) {
      onSubmit(value.trim());
    }
  };

  const handleClear = () => {
    onChange?.('');
  };

  const handleSuggestionClick = (query: string) => {
    onChange?.(query);
    onSubmit?.(query);
  };

  const hasText = value.trim().length > 0;

  return (
    <div className="w-full space-y-4">
      {/* Suggestion Buttons */}
      {showSuggestions && (
        <div className="flex flex-wrap gap-2 justify-center">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => handleSuggestionClick(suggestion.query)}
              disabled={disabled}
              className="px-4 py-2 bg-surface-elevated hover:bg-background-input text-text-secondary hover:text-text-primary text-sm rounded-full border border-border transition-colors disabled:opacity-50"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="w-full">
        <div className="relative">
          {/* Search icon - left */}
          <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
            <span className="text-text-muted text-xl">🔍</span>
          </div>

          <input
            type="text"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder="Ask anything about your family videos..."
            disabled={disabled}
            className="w-full bg-background-input rounded-lg pl-14 pr-14 py-5 text-lg text-text-primary placeholder:text-text-muted border border-border focus:outline-none focus:ring-2 focus:ring-action-primary/50 transition-all disabled:opacity-60"
          />

          {/* Dynamic action button - right */}
          <div className="absolute inset-y-0 right-4 flex items-center">
            {/* Only show clear/search buttons when not disabled */}
            {!disabled && (
              <>
                {hasText ? (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="text-text-muted hover:text-text-primary transition-colors p-2 rounded-full hover:bg-surface-elevated"
                    aria-label="Clear search"
                  >
                    <span className="text-xl">×</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="text-text-muted hover:text-action-primary transition-colors p-2 rounded-full hover:bg-surface-elevated"
                    aria-label="Search"
                  >
                    <span className="text-xl">→</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
