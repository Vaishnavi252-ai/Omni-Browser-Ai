@'
import { create, insertMultiple, search } from "@orama/orama";
import { CreateEngine } from "@mlc-ai/web-llm";

let dbInstance: any = null;
let llmEngine: any = null;

async function initDatabase() {
  if (dbInstance) return dbInstance;
  dbInstance = await create({
    schema: {
      text: "string",
      url: "string",
      title: "string"
    }
  });
  return dbInstance;
}

async function initLLMEngine() {
  if (llmEngine) return llmEngine;
  const targetModel = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
  llmEngine = await CreateEngine(targetModel, {
    initProgressCallback: (progress) => {
      chrome.runtime.sendMessage({ type: "ENGINE_COMPILE_STATUS", status: progress.text });
    }
  });
  return llmEngine;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const db = await initDatabase();

    if (message.type === "TAB_SCRAPED_DATA") {
      const { url, title, chunks } = message;
      const documents = chunks.map((paragraph: string) => ({
        text: paragraph,
        url: url,
        title: title
      }));
      await insertMultiple(db, documents);
      sendResponse({ status: "SUCCESS", count: chunks.length });
    }

    if (message.type === "RUN_LOCAL_INFERENCE") {
      const searchResults = await search(db, {
        term: message.query,
        limit: 3
      });

      const contextText = searchResults.hits.map(h => `[Source: ${h.document.title}] ${h.document.text}`).join("\n\n");
      const completePrompt = `Context from user open browser tabs:\n${contextText}\n\nQuestion: ${message.query}\n\nAnswer the question accurately using only the context provided above.`;

      const engine = await initLLMEngine();
      const output = await engine.chat.completions.create({
        messages: [{ role: "user", content: completePrompt }],
        stream: false
      });

      const citations = searchResults.hits.map(h => ({
        title: h.document.title,
        url: h.document.url
      }));

      chrome.runtime.sendMessage({
        type: "INFERENCE_COMPLETE_RESPONSE",
        answer: output.choices[0].message.content,
        citations: citations
      });
      sendResponse({ status: "INFERENCE_STARTED" });
    }
  })();
  return true;
});
'@ | Out-File -FilePath src/offscreen/offscreen.ts -Encoding utf8