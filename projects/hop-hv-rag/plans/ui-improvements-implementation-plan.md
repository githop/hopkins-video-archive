# UI Improvements Implementation Plan

**Branch:** `ui-overhaul`  
**Date:** 2026-01-29  
**Status:** Ready for Implementation

---

## Overview

This plan addresses four UX improvements identified on the `ui-overhaul` branch:

1. **Theme Toggle Bug**: Theme reverts to OS preference on every re-render after manual toggle
2. **Search Reset Behavior**: Replace "New Search" button that returns to splash page with inline clear/search toggle button
3. **Static Placeholder**: Replace generic placeholder with data-driven, curated examples
4. **Reasoning Block UX**: Auto-collapse reasoning block when complete, keeping UI focused on answer

---

## 1. Bug Fix: Theme Toggle Over-reactivity

### Problem Analysis

**File:** `packages/ui/src/components/ThemeToggle.tsx` (lines 18-32)

The component uses `useSyncExternalStore` to subscribe to OS theme changes:

```typescript
const systemTheme = useSyncExternalStore<'lotus' | 'dragon'>(
  subscribeThemeChange,
  getSystemTheme,
  () => 'lotus',
);

// This runs on every render, overriding any manual toggle!
applyTheme(systemTheme);
```

**Issue:** When user manually toggles theme, `systemTheme` remains subscribed to OS changes. Any re-render (from parent or sibling component state changes) causes `applyTheme(systemTheme)` to execute, reverting the theme back to OS preference.

### Solution

Store user preference in component state and only read OS setting once on initialization. Apply theme directly in the toggle callback without needing an effect:

**Implementation:**

```typescript
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

  // ... rest of component
}
```

**Changes:**

- Remove `useSyncExternalStore` subscription to OS theme
- Add `useState` with lazy initializer that reads OS setting once and applies immediately
- Apply theme directly in `toggleTheme` callback
- No `useEffect` needed - state and DOM stay synchronized via callback
- OS preference changes are now ignored after initial load (desired behavior)

---

## 2. Improvement: Inline Clear/Search Button

### Problem Analysis

**Current Behavior:**

- User searches → results appear
- To search again, must click "New Search" button in header
- This calls `handleNewSearch()` which resets to `phase: 'idle'`
- User returns to full splash page with large search form

**Desired Behavior:**

- Single button inside the search bar
- **If text present:** Button shows "×" (clear) icon, clears input when clicked
- **If text empty:** Button shows "→" (search) icon, submits form when clicked
- Search bar stays in compact mode (no return to splash page)
- Remove the "New Search" button from header entirely

### Solution

**File Changes:**

#### A. `packages/ui/src/components/SearchBar.tsx`

Replace current structure with inline button:

```typescript
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
  placeholder,
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

  const hasText = value.trim().length > 0;

  if (mode === 'display') {
    // ... keep existing display mode logic
  }

  return (
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
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-background-input rounded-lg pl-14 pr-14 py-5 text-lg text-text-primary placeholder:text-text-muted border border-border focus:outline-none focus:ring-2 focus:ring-action-primary/50 transition-all disabled:opacity-60"
        />

        {/* Dynamic action button - right */}
        <div className="absolute inset-y-0 right-4 flex items-center">
          {hasText ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              className="text-text-muted hover:text-text-primary transition-colors p-2 rounded-full hover:bg-surface-elevated"
              aria-label="Clear search"
            >
              <span className="text-xl">×</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled}
              className="text-text-muted hover:text-action-primary transition-colors p-2 rounded-full hover:bg-surface-elevated disabled:opacity-50"
              aria-label="Search"
            >
              <span className="text-xl">→</span>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
```

**Key Changes:**

- Remove standalone "Search Archive" button below input
- Add right-side button inside input container
- Button conditionally renders: clear (×) when has text, submit (→) when empty
- Adjust padding (`pr-14`) to accommodate right button

#### B. `packages/ui/src/components/Header.tsx`

Remove `onNewSearch` prop and button:

```typescript
// Remove interface and prop
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
            HOPKINS ARCHIVE
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
```

#### C. `packages/ui/src/App.tsx`

Simplify by removing `handleNewSearch` and header prop:

```typescript
function App() {
  const [input, setInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const {
    phase,
    reasoning,
    answer,
    sources,
    usedSourceIds,
    error,
    search,
    reset,
  } = useArchivistQuery();

  const handleSearch = (query: string) => {
    setSubmittedQuery(query);
    search(query);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header - no props needed */}
      <Header />

      {/* Rest of component... */}
      {/* SearchBar will now handle its own clear behavior */}
    </div>
  );
}
```

---

## 3. Improvement: Data-Driven Placeholders

### Analysis

**Current:** Static generic placeholder: `"Find the video where dad drops the cake in the kitchen..."`

**Data Assets Available:**

- 184 videos spanning 1984-2021 (37 years)
- Top participants by scene count: Greg (416), Karen (247), Mom (196), Dad (169), Geoff (151)
- Top activities: Birthday (71), Christmas (49), Fishing (35), Swimming (28), Football (27)
- Top locations: Home (62), Kitchen (24), Beach (21), Boat (17), Pool (15), Lake Cumberland (10)
- Years distributed across 4 decades of family memories

### Solution

Create curated natural language examples that reflect real archive content:

**File:** `packages/ui/src/components/SearchBar.tsx`

**Add placeholder array and random selection:**

```typescript
// Curated examples based on real archive data
const PLACEHOLDERS = [
  // Person-focused
  'Show me videos with Dad fishing at Lake Cumberland',
  'Find birthday celebrations with Grandma',
  'What Christmas videos feature Geoff?',
  'Show me scenes with Mom at the beach',

  // Activity-focused
  'Find fishing trips from the 1990s',
  'Show me football games and practices',
  'What swimming pool memories do we have?',
  'Find our family boat trips',

  // Location-focused
  'Show me videos taken at the Hopkins Family Home',
  "Find scenes from Christmas at Grandma's House",
  'What happened at Lake Cumberland?',
  'Show me backyard birthday parties',

  // Time-focused
  'Find videos from the early 2000s',
  'What do we have from the 1990s?',
  'Show me the oldest family videos',
  'Find recent videos from 2020-2021',

  // Combined
  'Find Dad teaching Geoff to fish',
  "Show me Karen's birthday parties at home",
  'What Christmas mornings are on video?',
  'Find football practice in the backyard',
];

// Randomly select one on component mount
function useRandomPlaceholder(): string {
  return useMemo(() => {
    const index = Math.floor(Math.random() * PLACEHOLDERS.length);
    return PLACEHOLDERS[index];
  }, []); // Empty deps = only on mount
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  mode = 'input',
  disabled = false,
  placeholder: externalPlaceholder,
}: SearchBarProps) {
  const randomPlaceholder = useRandomPlaceholder();
  const placeholder = externalPlaceholder ?? randomPlaceholder;

  // ... rest of component
}
```

**Placeholder Categories:**

| Category             | Examples                                             | Rationale                                                 |
| -------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| **Person-focused**   | Dad fishing, Grandma's birthdays, Geoff's activities | Greg, Karen, Mom, Dad, Geoff are most frequent            |
| **Activity-focused** | Fishing, birthdays, Christmas, football              | Birthday (71), Christmas (49), Fishing (35) most common   |
| **Location-focused** | Hopkins Home, Lake Cumberland, beach, backyard       | Home appears in 62 scenes, recognizable family locations  |
| **Time-focused**     | 1990s, early 2000s, oldest videos                    | Archive spans 1984-2021, temporal search is a key feature |
| **Combined**         | Dad teaching Geoff, Karen's home birthdays           | Natural language combining entities shows capability      |

**Notes:**

- Use `useMemo` with empty deps to select once on mount
- Allow external override via `placeholder` prop (for testing/debugging)
- Rotate through different types to showcase diverse capabilities

---

## 4. Enhancement: Auto-Collapse Reasoning Block

### Problem Analysis

**File:** `packages/ui/src/components/ReasoningBlock.tsx`

Currently the reasoning block:

- Always starts expanded (`useState(true)`)
- Stays expanded after reasoning completes and answer appears
- Takes up visual space when user wants to focus on the answer

**Current Flow:**

1. User submits query → phase: 'thinking'
2. Reasoning streams in → ReasoningBlock expanded
3. Result arrives → phase: 'complete'
4. ReasoningBlock stays expanded (cluttered UI)

**Desired Flow:**

1. User submits query → phase: 'thinking'
2. Reasoning streams in → ReasoningBlock **expanded** (show progress)
3. Result arrives → phase: 'complete'
4. ReasoningBlock **auto-collapses** (clean focus on answer)
5. User can still manually expand to review reasoning

### Solution

Pass the `phase` prop to ReasoningBlock and auto-collapse when transitioning to 'complete':

**A. Update `packages/ui/src/hooks/useArchivistQuery.ts` - Expose Phase Type**

Export the Phase type for use in components:

```typescript
export type Phase = 'idle' | 'thinking' | 'complete' | 'error';
```

**B. Update `packages/ui/src/components/ReasoningBlock.tsx`**

```typescript
import { useState, useEffect } from 'react';
import type { Phase } from '../hooks/useArchivistQuery';

interface ReasoningBlockProps {
  reasoning: string;
  phase: Phase;
}

export function ReasoningBlock({ reasoning, phase }: ReasoningBlockProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Auto-collapse when reasoning completes
  useEffect(() => {
    if (phase === 'complete') {
      setIsExpanded(false);
    } else if (phase === 'thinking') {
      // Ensure expanded during thinking (in case user manually collapsed)
      setIsExpanded(true);
    }
  }, [phase]);

  // Parse reasoning into lines for display
  const lines = reasoning.split('\n').filter((line) => line.trim());

  return (
    <div className="bg-background-code border border-border rounded-lg overflow-hidden">
      {/* Header / Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-text-secondary hover:text-text-primary transition-colors border-b border-border/50"
      >
        <div className="flex items-center gap-2">
          <span className="text-action-secondary">⚙</span>
          <span className="font-mono text-xs uppercase tracking-wide">
            {phase === 'thinking' ? 'Reasoning...' : 'Reasoning Process'}
          </span>
        </div>
        <span className="text-xs transform transition-transform duration-200">
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 py-3 font-mono text-sm space-y-1">
          {/* existing content logic */}
        </div>
      )}
    </div>
  );
}
```

**C. Update `packages/ui/src/App.tsx`**

Pass `phase` prop to ReasoningBlock components:

```typescript
{/* Thinking State - Reasoning Block */}
{phase === 'thinking' && reasoning && (
  <ReasoningBlock reasoning={reasoning} phase={phase} />
)}

{/* Complete State */}
{phase === 'complete' && (
  <>
    {/* Reasoning (if available) */}
    {reasoning && <ReasoningBlock reasoning={reasoning} phase={phase} />}
    {/* ... */}
  </>
)}
```

**Key Changes:**

- Export `Phase` type from hook for component usage
- Add `phase` prop to ReasoningBlock interface
- Add `useEffect` that watches phase changes:
  - `'thinking'` → expand block (show process)
  - `'complete'` → collapse block (clean UI)
- Update header label to show "Reasoning..." during thinking phase
- User can still manually toggle after auto-collapse

---

## Implementation Order

1. **Theme Toggle Fix** - Isolated change, affects only ThemeToggle.tsx
2. **Search Bar Refactor** - Update SearchBar.tsx with inline button + placeholders
3. **Header Cleanup** - Remove onNewSearch from Header.tsx
4. **Hook Export** - Export Phase type from useArchivistQuery.ts
5. **Reasoning Block Enhancement** - Add phase prop and auto-collapse logic
6. **App Integration** - Remove handleNewSearch, update ReasoningBlock usage with phase prop

---

## Testing Checklist

### Theme Toggle

- [ ] Page loads honoring OS preference (dark→dragon, light→lotus)
- [ ] Toggle button switches theme immediately
- [ ] Navigate to another tab and return - theme persists
- [ ] Trigger re-render in parent component - theme persists
- [ ] Hard refresh - reads OS preference again (acceptable)

### Search Bar

- [ ] Random placeholder shown on initial load (different on refresh)
- [ ] Type text → clear button (×) appears
- [ ] Click clear → input emptied, search button (→) appears
- [ ] Empty input → search button (→) visible
- [ ] Click search with empty input → no submission
- [ ] Click search with text → form submits
- [ ] Press Enter → form submits (existing behavior preserved)
- [ ] Display mode → read-only query shown (unchanged)

### Search Flow

- [ ] Submit search → results appear
- [ ] Clear button in compact search bar → input cleared, stay in compact mode
- [ ] Type new query → submit → new results
- [ ] No "New Search" button in header
- [ ] No splash page return between searches

### Reasoning Block

- [ ] Submit query → ReasoningBlock appears expanded
- [ ] Reasoning streams in while expanded → visible to user
- [ ] Phase changes to 'complete' → ReasoningBlock auto-collapses
- [ ] Click ReasoningBlock header → manually expands to review
- [ ] Click again → manually collapses
- [ ] Header shows "Reasoning..." during thinking phase
- [ ] Header shows "Reasoning Process" after complete

---

## File Summary

| File                                            | Changes                                                  |
| ----------------------------------------------- | -------------------------------------------------------- |
| `packages/ui/src/hooks/useArchivistQuery.ts`    | Export Phase type for component usage                    |
| `packages/ui/src/components/ThemeToggle.tsx`    | Replace useSyncExternalStore with useState + callback    |
| `packages/ui/src/components/SearchBar.tsx`      | Add inline clear/search button, random placeholder logic |
| `packages/ui/src/components/Header.tsx`         | Remove onNewSearch prop and button                       |
| `packages/ui/src/components/ReasoningBlock.tsx` | Add phase prop, auto-collapse on complete                |
| `packages/ui/src/App.tsx`                       | Remove handleNewSearch, add phase prop to ReasoningBlock |

---

## Next Steps

This plan is ready for implementation. Execute in a new session by:

1. Reading this plan
2. Implementing ThemeToggle fix
3. Implementing SearchBar improvements
4. Cleaning up Header component
5. Exporting Phase type from hook
6. Adding phase prop and auto-collapse to ReasoningBlock
7. Updating App.tsx with new ReasoningBlock usage
8. Testing all scenarios

**Estimated effort:** 3-4 hours including testing
