import { create, insertMultiple, search } from '@orama/orama';
import { CreateMLCEngine } from '@mlc-ai/web-llm';

type Citation = {
  title: string;
  url: string;
};

type IngestionMessage = {
  type?: string;
  url?: string;
  title?: string;
  chunks?: unknown;
  query?: string;
};

type RuntimeMessage = {
  type: string;
  status?: string;
  answer?: string;
  citations?: Citation[];
  error?: string;
};

type StoredDocument = {
  text: string;
  url: string;
  title: string;
};

type SearchHit = {
  document: StoredDocument;
};

type SearchResponse = {
  hits: SearchHit[];
};

let dbPromise: any = null;
let llmEnginePromise: Promise<unknown> | null = null;
let engineInstance: any = null;
let isEngineInitializing = false;

async function resetRuntimeState(): Promise<void> {
  dbPromise = null;
  llmEnginePromise = null;
  engineInstance = null;
  isEngineInitializing = false;
}

function normalizeChunks(chunks: unknown): string[] {
  if (!Array.isArray(chunks)) {
    return [];
  }

  return chunks
    .filter((chunk): chunk is string => typeof chunk === 'string')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();

  return citations.filter((citation) => {
    const key = `${citation.title.toLowerCase()}::${citation.url.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getHostname(url: string): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function rankContextHits(hits: SearchHit[], activeTitle: string, activeUrl: string): SearchHit[] {
  const normalizedActiveTitle = activeTitle.trim().toLowerCase();
  const activeHostname = getHostname(activeUrl);

  return [...hits].sort((a, b) => {
    const aScore = getContextHitScore(a.document, normalizedActiveTitle, activeHostname, activeUrl);
    const bScore = getContextHitScore(b.document, normalizedActiveTitle, activeHostname, activeUrl);
    return bScore - aScore;
  });
}

function getContextHitScore(document: StoredDocument, activeTitle: string, activeHostname: string | null, activeUrl: string): number {
  const normalizedTitle = document.title.trim().toLowerCase();
  const hostname = getHostname(document.url);
  let score = 0;

  if (normalizedTitle && activeTitle && normalizedTitle === activeTitle) {
    score += 1000;
  }

  if (normalizedTitle && activeTitle && (normalizedTitle.includes(activeTitle) || activeTitle.includes(normalizedTitle))) {
    score += 250;
  }

  if (hostname && activeHostname && hostname === activeHostname) {
    score += 150;
  }

  if (document.url && activeUrl && document.url === activeUrl) {
    score += 500;
  }

  return score;
}

function sendRuntimeMessage(message: RuntimeMessage): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        console.warn('OmniBrowser AI runtime message failed:', chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

async function initDatabase(): Promise<any> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = await create({
    schema: {
      text: 'string',
      url: 'string',
      title: 'string',
    },
  });

  return dbPromise;
}

async function initLLMEngine(): Promise<any> {
  if (engineInstance) {
    return engineInstance;
  }

  if (isEngineInitializing && llmEnginePromise) {
    return llmEnginePromise;
  }

  isEngineInitializing = true;

  try {
    const targetModel = "Qwen2-0.5B-Instruct-q4f16_1-MLC";
    llmEnginePromise = CreateMLCEngine(targetModel, {
      initProgressCallback: (progress: { text: string }) => {
        void sendRuntimeMessage({ type: 'ENGINE_COMPILE_STATUS', status: progress.text });
      },
    });

    engineInstance = await llmEnginePromise;
    return engineInstance;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown engine initialization error';
    console.warn('OmniBrowser AI: failed to initialize WebLLM engine', errorMessage);
    engineInstance = null;
    llmEnginePromise = null;
    throw new Error(errorMessage);
  } finally {
    isEngineInitializing = false;
  }
}

chrome.runtime.onMessage.addListener((message: IngestionMessage, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  void (async () => {
    try {
      const db = await initDatabase();

      if (message.type === 'TAB_SCRAPED_DATA') {
        const normalizedChunks = normalizeChunks(message.chunks);
        const documents: StoredDocument[] = normalizedChunks.map((chunk) => ({
          text: chunk,
          url: message.url ?? '',
          title: message.title ?? 'Untitled tab',
        }));

        if (documents.length > 0) {
          await insertMultiple(db, documents);
        }

        sendResponse({ status: 'SUCCESS', count: documents.length });
        return;
      }

      if (message.type === 'PURGE_ALL_DATA') {
        if (dbPromise) {
          const db = await dbPromise;
          if (typeof db?.delete === 'function') {
            await db.delete();
          }
        }

        await resetRuntimeState();
        await sendRuntimeMessage({ type: 'PURGE_ALL_DATA_SUCCESS' });
        sendResponse({ status: 'PURGED' });
        return;
      }

      if (message.type === 'RESET_OFFSCREEN') {
        await resetRuntimeState();
        await sendRuntimeMessage({ type: 'ENGINE_LOAD_ERROR', error: 'Engine reset requested. Please retry the inference.' });
        sendResponse({ status: 'RESET_COMPLETE' });
        return;
      }

      if (message.type === 'RUN_LOCAL_INFERENCE') {
        const query = (message.query ?? '').trim();

        if (!query) {
          await sendRuntimeMessage({ type: 'INFERENCE_COMPLETE_RESPONSE', answer: 'Please provide a question to run locally.', citations: [] });
          sendResponse({ status: 'EMPTY_QUERY' });
          return;
        }

        let activeTitle = '';
        let activeUrl = '';

        try {
          const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
          activeTitle = activeTab[0]?.title?.trim() ?? '';
          activeUrl = activeTab[0]?.url ?? '';
        } catch (error) {
          console.warn('OmniBrowser AI: failed to read active tab context for retrieval', error);
        }

        const searchResults = (await search(db as never, {
          term: query,
          limit: 10,
        })) as unknown as SearchResponse;

        const hits = searchResults.hits ?? [];
        const rankedHits = rankContextHits(hits, activeTitle, activeUrl).slice(0, 3);
        const contextBlocks = rankedHits.map((hit) => `[Source: ${hit.document.title}] ${hit.document.text}`);
        const contextText = contextBlocks.length > 0 ? contextBlocks.join('\n\n') : 'No relevant tab context was found.';
        const prompt = `You are OmniBrowser AI. Answer the user's question using only the supplied context. If the context is insufficient, say so clearly.\n\nContext:\n${contextText}\n\nQuestion: ${query}\n\nAnswer:`;

        const engine = (await initLLMEngine()) as {
          chat: {
            completions: {
              create: (options: { messages: Array<{ role: string; content: string }>; stream: boolean }) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
            };
          };
        };

        const output = await engine.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        });

        const answer = output.choices?.[0]?.message?.content ?? 'No answer generated.';
        const citations = dedupeCitations(
          rankedHits.map((hit) => ({
            title: hit.document.title,
            url: hit.document.url,
          })),
        );

        await sendRuntimeMessage({
          type: 'INFERENCE_COMPLETE_RESPONSE',
          answer,
          citations,
        });

        sendResponse({ status: 'SUCCESS', answer, citationsCount: citations.length });
        return;
      }

      sendResponse({ status: 'IGNORED' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown offscreen runtime error';
      void sendRuntimeMessage({ type: 'INFERENCE_ERROR', error: errorMessage });
      sendResponse({ status: 'ERROR', error: errorMessage });
    }
  })();

  return true;
});
