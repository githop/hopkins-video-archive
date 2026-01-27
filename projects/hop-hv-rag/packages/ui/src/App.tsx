import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { useArchivistQuery } from './hooks/useArchivistQuery';
import { SourceList } from './components/SourceList';

function App() {
  const [input, setInput] = useState('');
  const { phase, reasoning, answer, sources, error, search } =
    useArchivistQuery();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      search(input.trim());
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="p-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-semibold text-gray-800">
          Family Archive Search
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        {phase === 'idle' && (
          <p className="text-center text-gray-500 mt-8">
            Ask a question about your family videos...
          </p>
        )}

        {phase === 'thinking' && (
          <div className="bg-gray-100 rounded-lg p-4 mb-4">
            <div className="text-sm text-gray-500 mb-2">Thinking...</div>
            {reasoning && (
              <div className="prose prose-sm text-gray-600 italic max-w-none">
                <Streamdown>{reasoning}</Streamdown>
              </div>
            )}
          </div>
        )}

        {phase === 'complete' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-4 border border-gray-200 prose prose-slate max-w-none">
              <Streamdown>{answer}</Streamdown>
            </div>
            {sources.length > 0 && <SourceList sources={sources} />}
          </div>
        )}

        {phase === 'error' && (
          <div className="bg-red-50 text-red-700 rounded-lg p-4">
            Error: {error}
          </div>
        )}
      </main>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-200 bg-white"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput((e.target as HTMLInputElement).value)}
            placeholder="Ask about your family videos..."
            className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={phase === 'thinking'}
          />
          <button
            type="submit"
            disabled={phase === 'thinking'}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Search
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
