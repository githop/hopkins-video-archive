import { useState } from 'react';
import { useArchivistQuery } from './hooks/useArchivistQuery';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { ReasoningBlock } from './components/ReasoningBlock';
import { AnswerSection } from './components/AnswerSection';
import { SourceGrid } from './components/SourceGrid';

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

  const handleNewSearch = () => {
    reset();
    setInput('');
    setSubmittedQuery('');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <Header onNewSearch={phase !== 'idle' ? handleNewSearch : undefined} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {/* Search Section - Full page when idle, compact when results shown */}
        <div
          className={`
          px-6 py-12 transition-all duration-500
          ${phase === 'idle' ? 'flex-1 flex flex-col justify-center' : 'bg-background-surface border-b border-border'}
        `}
        >
          <div className="max-w-3xl mx-auto w-full">
            {/* Show prominent search when idle or thinking */}
            {(phase === 'idle' || phase === 'thinking') && (
              <div className="text-center mb-8">
                <h2 className="font-serif text-3xl md:text-4xl text-text-primary mb-3">
                  Search Your Archive
                </h2>
                <p className="text-text-secondary">
                  Ask questions about your family videos in natural language
                </p>
              </div>
            )}

            {/* Search Input */}
            <SearchBar
              value={
                phase === 'idle' || phase === 'thinking'
                  ? input
                  : submittedQuery
              }
              onChange={
                phase === 'idle' || phase === 'thinking' ? setInput : undefined
              }
              onSubmit={handleSearch}
              mode={
                phase === 'idle' || phase === 'thinking' ? 'input' : 'display'
              }
              disabled={phase === 'thinking'}
            />
          </div>
        </div>

        {/* Results Section */}
        {phase !== 'idle' && (
          <div className="flex-1 px-6 py-8">
            <div className="max-w-3xl mx-auto space-y-8">
              {/* Error State */}
              {phase === 'error' && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-600 rounded-lg p-4">
                  <strong>Error:</strong> {error}
                </div>
              )}

              {/* Thinking State - Reasoning Block */}
              {phase === 'thinking' && reasoning && (
                <ReasoningBlock reasoning={reasoning} />
              )}

              {/* Complete State */}
              {phase === 'complete' && (
                <>
                  {/* Reasoning (if available) */}
                  {reasoning && <ReasoningBlock reasoning={reasoning} />}

                  {/* Answer */}
                  {answer && <AnswerSection answer={answer} />}

                  {/* Sources */}
                  {sources.length > 0 && (
                    <SourceGrid
                      sources={sources}
                      usedSourceIds={usedSourceIds}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
