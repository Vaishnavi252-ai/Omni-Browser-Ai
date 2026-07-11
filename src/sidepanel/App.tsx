import { useEffect, useMemo, useState } from 'react';

type WorkspaceTab = 'chat' | 'data' | 'settings';

type Citation = {
  title: string;
  url: string;
};

type TabContextItem = {
  id: number;
  title: string;
  url: string;
  enabled: boolean;
};

const parseEngineProgress = (status?: string) => {
  if (!status) {
    return 0;
  }

  const percentMatch = status.match(/(\d{1,3})\s*%/i);
  if (percentMatch) {
    return Math.min(100, Math.max(0, Number(percentMatch[1])));
  }

  if (/complete|ready|loaded|done/i.test(status)) {
    return 100;
  }

  if (/download|loading|initializing|compile|model/i.test(status)) {
    return 25;
  }

  return 0;
};

const initialTabs: TabContextItem[] = [
  { id: 1, title: 'Hackathon Brief', url: 'https://example.com/brief', enabled: true },
  { id: 2, title: 'Research Notes', url: 'https://example.com/notes', enabled: true },
  { id: 3, title: 'Design System', url: 'https://example.com/design', enabled: false },
  { id: 4, title: 'Judge Demo Flow', url: 'https://example.com/demo', enabled: true },
];

function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');
  const [inputValue, setInputValue] = useState('Summarize the most relevant context from my open tabs.');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [statusText, setStatusText] = useState('Ready to reason locally.');
  const [engineProgress, setEngineProgress] = useState(0);
  const [isInferenceRunning, setIsInferenceRunning] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [tabs, setTabs] = useState(initialTabs);
  const [batteryMode, setBatteryMode] = useState<'low' | 'deep'>('deep');

  useEffect(() => {
    const listener = (message: any) => {
      if (!message?.type) {
        return;
      }

      if (message.type === 'ENGINE_COMPILE_STATUS') {
        const nextProgress = parseEngineProgress(message.status);
        setEngineProgress(nextProgress);
        setStatusText(message.status || 'Preparing local engine…');
        return;
      }

      if (message.type === 'INFERENCE_COMPLETE_RESPONSE') {
        setAnswer(message.answer || 'No answer generated.');
        setCitations(message.citations || []);
        setStatusText('Inference completed locally.');
        setEngineProgress(100);
        setIsInferenceRunning(false);
        setUiError(null);
        return;
      }

      if (message.type === 'INFERENCE_ERROR' || message.type === 'ENGINE_LOAD_ERROR') {
        setStatusText(message.error || 'Inference failed.');
        setUiError(message.error || 'The local engine could not complete the request.');
        setIsInferenceRunning(false);
        setIsResetting(false);
      }

      if (message.type === 'PURGE_ALL_DATA_SUCCESS') {
        setStatusText('Local memory caches wiped.');
        setUiError(null);
      }
    };

    chrome.runtime?.onMessage.addListener(listener);
    return () => chrome.runtime?.onMessage.removeListener(listener);
  }, []);

  const handleRunInference = () => {
    if (!inputValue.trim()) {
      setStatusText('Type a question before running the local engine.');
      return;
    }

    setIsInferenceRunning(true);
    setUiError(null);
    setStatusText('Dispatching local query…');
    chrome.runtime?.sendMessage(
      {
        type: 'RUN_LOCAL_INFERENCE',
        query: inputValue.trim(),
      },
      (response: any) => {
        if (chrome.runtime.lastError) {
          setUiError(chrome.runtime.lastError.message || 'The request could not be delivered.');
          setIsInferenceRunning(false);
          return;
        }

        if (response?.status === 'ERROR') {
          setUiError(response.error || 'Inference failed.');
          setIsInferenceRunning(false);
        }
      },
    );
  };

  const handleResetEngine = () => {
    setIsResetting(true);
    setUiError(null);
    setStatusText('Resetting offscreen engine…');
    chrome.runtime?.sendMessage({ type: 'RESET_OFFSCREEN' }, (response: any) => {
      if (chrome.runtime.lastError) {
        setUiError(chrome.runtime.lastError.message || 'The engine reset could not be completed.');
        setIsResetting(false);
        return;
      }

      setEngineProgress(0);
      setStatusText(response?.status === 'RESET_COMPLETE' ? 'Engine reset complete. Ready to retry.' : 'Engine reset requested.');
      setIsResetting(false);
    });
  };

  const confirmPurge = () => {
    setIsConfirmOpen(false);
    setStatusText('Purging local memory…');
    setAnswer('');
    setCitations([]);
    setEngineProgress(0);
    chrome.runtime?.sendMessage({ type: 'PURGE_ALL_DATA' }, (response: any) => {
      if (chrome.runtime.lastError) {
        setUiError(chrome.runtime.lastError.message || 'Could not purge the local memory cache.');
        return;
      }

      if (response?.status === 'PURGED') {
        setStatusText('Local memory caches wiped.');
        setUiError(null);
      }
    });
  };

  const toggleTab = (id: number) => {
    setTabs((current) =>
      current.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item)),
    );
  };

  const summary = useMemo(() => {
    const enabledCount = tabs.filter((item) => item.enabled).length;
    return `${enabledCount}/${tabs.length} context sources active`;
  }, [tabs]);

  return (
    <div className="min-h-screen bg-[#080B11] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-3 py-3 sm:px-4 lg:px-5">
        <header className="mb-3 rounded-2xl border border-white/10 bg-[#111622]/95 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_10px_40px_rgba(0,0,0,0.28)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.35em] text-[#FF6B00]">
                <span className="h-2 w-2 rounded-full bg-[#FF6B00]" />
                OmniBrowser AI
              </div>
              <h1 className="text-xl font-semibold text-white">Offline-first browser intelligence workspace</h1>
              <p className="mt-1 text-sm text-slate-400">
                Private local RAG across active tabs with WebGPU-backed reasoning.
              </p>
            </div>
            <div className="rounded-xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-3 py-2 text-sm text-[#C4B5FD]">
              <div className="font-medium">{summary}</div>
              <div className="text-xs text-slate-400">{statusText}</div>
            </div>
          </div>
        </header>

        {uiError && (
          <div className="mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            <div className="font-medium">Runtime guardrail triggered</div>
            <div className="mt-1 text-red-100/80">{uiError}</div>
            <button
              type="button"
              onClick={handleResetEngine}
              disabled={isResetting}
              className="mt-3 rounded-xl border border-red-400/30 bg-red-600/20 px-3 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isResetting ? 'Resetting…' : 'System Reset'}
            </button>
          </div>
        )}

        <nav className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-[#111622]/70 p-2">
          {[
            { key: 'chat', label: '💬 Chat Workspace' },
            { key: 'data', label: '🗂️ Data Hub Matrix' },
            { key: 'settings', label: '⚙️ Engine Room' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as WorkspaceTab)}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                activeTab === tab.key
                  ? 'bg-[#FF6B00] text-white shadow-lg shadow-[#FF6B00]/20'
                  : 'bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 rounded-2xl border border-white/10 bg-[#111622]/90 p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-4">
          {activeTab === 'chat' && (
            <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-2xl border border-white/10 bg-[#080B11]/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Conversation cockpit</h2>
                    <p className="text-sm text-slate-400">Ask questions against your local tab memory.</p>
                  </div>
                  <span className="rounded-full border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-2.5 py-1 text-xs text-[#C4B5FD]">
                    Local RAG
                  </span>
                </div>
                <textarea
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-white/10 bg-[#0E1420] px-3 py-3 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
                  placeholder="Ask OmniBrowser AI anything about your open tabs..."
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRunInference}
                    disabled={isInferenceRunning}
                    className="rounded-xl bg-[#FF6B00] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isInferenceRunning ? 'Running…' : 'RUN ⚡'}
                  </button>
                  <span className="text-sm text-slate-500">Works fully offline when the engine is loaded.</span>
                </div>
                <div className="mt-4 rounded-xl border border-white/10 bg-[#0E1420] p-3">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-300">Engine compile status</span>
                    <span className="text-slate-400">{engineProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#FF6B00] to-[#8B5CF6] transition-all duration-500 ease-out"
                      style={{ width: `${Math.max(4, engineProgress)}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{statusText}</div>
                </div>
                <div className="mt-4 rounded-xl border border-white/10 bg-[#0E1420] p-3">
                  <div className="mb-2 text-sm font-medium text-slate-300">Answer</div>
                  <div className="min-h-[100px] whitespace-pre-wrap text-sm leading-7 text-slate-200">
                    {answer || 'Your response will appear here after the local engine completes the inference.'}
                  </div>
                  {citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {citations.map((citation) => (
                        <button
                          key={`${citation.title}-${citation.url}`}
                          type="button"
                          onClick={() => {
                            void chrome.tabs.update({ url: citation.url, active: true });
                          }}
                          className="rounded-full border border-violet-700/50 bg-violet-900/30 px-3 py-1 text-sm text-violet-300 transition hover:bg-violet-800/40"
                        >
                          {citation.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <aside className="rounded-2xl border border-white/10 bg-[#080B11]/70 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-[#8B5CF6]">Context pulse</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="rounded-xl border border-white/10 bg-[#111622] p-3">
                    <div className="font-medium text-white">Indexed memory</div>
                    <div className="mt-1 text-slate-400">The engine uses browser-tab content as retrieval context.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#111622] p-3">
                    <div className="font-medium text-white">Citations</div>
                    <div className="mt-1 text-slate-400">Clickable source badges appear here as soon as inference completes.</div>
                  </div>
                </div>
              </aside>
            </div>
          )}

          {activeTab === 'data' && (
            <section className="rounded-2xl border border-white/10 bg-[#080B11]/70 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Data hub matrix</h2>
                  <p className="text-sm text-slate-400">Choose which open-tab sources feed the local vector index.</p>
                </div>
                <div className="rounded-full border border-[#FF6B00]/25 bg-[#FF6B00]/10 px-3 py-1 text-sm text-[#FFB17A]">
                  {summary}
                </div>
              </div>
              <div className="grid gap-2">
                {tabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleTab(item.id)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left transition ${
                      item.enabled
                        ? 'border-[#8B5CF6]/25 bg-[#8B5CF6]/10 text-slate-100'
                        : 'border-white/10 bg-[#111622] text-slate-400'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{item.title}</div>
                      <div className="text-xs opacity-70">{item.url}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs ${item.enabled ? 'bg-[#FF6B00] text-white' : 'bg-[#0E1420] text-slate-500'}`}>
                      {item.enabled ? 'Included' : 'Excluded'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'settings' && (
            <section className="grid gap-3 lg:grid-cols-[1fr_0.8fr]">
              <div className="rounded-2xl border border-white/10 bg-[#080B11]/70 p-4">
                <h2 className="text-lg font-semibold text-white">Engine room profiles</h2>
                <p className="mt-1 text-sm text-slate-400">Swap between fast and deep local execution modes.</p>
                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    onClick={() => setBatteryMode('low')}
                    className={`rounded-xl border px-3 py-3 text-left ${
                      batteryMode === 'low'
                        ? 'border-[#FF6B00]/40 bg-[#FF6B00]/10 text-white'
                        : 'border-white/10 bg-[#111622] text-slate-300'
                    }`}
                  >
                    <div className="font-medium">Low Battery Mode</div>
                    <div className="text-sm text-slate-400">Fast, light reasoning tuned to preserve local resources.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatteryMode('deep')}
                    className={`rounded-xl border px-3 py-3 text-left ${
                      batteryMode === 'deep'
                        ? 'border-[#8B5CF6]/40 bg-[#8B5CF6]/10 text-white'
                        : 'border-white/10 bg-[#111622] text-slate-300'
                    }`}
                  >
                    <div className="font-medium">Deep Reasoner</div>
                    <div className="text-sm text-slate-400">Higher fidelity reasoning with more compute overhead.</div>
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <h3 className="text-lg font-semibold text-red-200">Safety controls</h3>
                <p className="mt-2 text-sm text-red-100/80">
                  This purge clears local retrieval caches and resets the in-memory workspace state.
                </p>
                <button
                  type="button"
                  onClick={() => setIsConfirmOpen(true)}
                  className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                >
                  Wipe Local Memory Caches Now
                </button>
              </div>
            </section>
          )}
        </main>
      </div>

      {isConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-[#111622] p-5 shadow-2xl">
            <div className="text-lg font-semibold text-white">Confirm purge</div>
            <p className="mt-2 text-sm text-slate-400">
              This permanently clears the local Orama cache and resets the current inference state. Continue?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPurge}
                className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                Delete Local Memory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
