import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { SceneGallery } from './components/SceneGallery';
import { isArchivistToolPart } from '@hop-hv-rag/search';
import type { ArchivistUiMessage } from '@hop-hv-rag/search';

const transport = new DefaultChatTransport({
  api: 'http://local.gnarlybox-ai:3200/api/chat',
});

function App() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status } = useChat<ArchivistUiMessage>({
    transport,
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
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

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-gray-500 mt-8">
            Ask a question about your family videos...
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === 'user' ? 'text-right' : 'text-left'}
          >
            <div
              className={`inline-block p-3 rounded-lg max-w-[80%] ${
                m.role === 'user'
                  ? 'bg-blue-500 text-white whitespace-pre-wrap'
                  : 'bg-white border border-gray-200 text-gray-800 prose prose-slate max-w-none'
              }`}
            >
              <Streamdown>
                {m.parts
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join('')}
              </Streamdown>
            </div>

            {/* Tool Invocations from Parts */}
            {m.parts.map((part) => {
              if (isArchivistToolPart(part)) {
                const { toolCallId, state } = part;

                if (state === 'output-available') {
                  return (
                    <SceneGallery
                      key={toolCallId}
                      results={part.output.results}
                    />
                  );
                }
                return (
                  <div
                    key={toolCallId}
                    className="flex items-center gap-2 text-sm text-gray-500 italic py-2"
                  >
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                    Searching the family archive...
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
      </main>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-200 bg-white"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your family videos..."
            className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
