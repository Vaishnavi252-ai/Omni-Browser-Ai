// Background Service Worker
let isCreating = false;

async function setupOffscreenContext() {
  if (isCreating) {
    return;
  }

  isCreating = true;

  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts.length > 0) {
      return;
    }

    await chrome.offscreen.createDocument({
      url: 'src/offscreen/index.html',
      reasons: ['LOCAL_STORAGE'],
      justification: 'Mounts the offline WebGPU runtime in a DOM-backed offscreen context.',
    });
  } catch (error) {
    console.warn('OmniBrowser AI: failed to create offscreen context', error);
  } finally {
    isCreating = false;
  }
}

// Listen for tab updates or activation events to pulse context
chrome.tabs.onActivated.addListener(async (_activeInfo: any) => {
  updateTabContextMatrix();
});

chrome.tabs.onUpdated.addListener((_tabId: any, changeInfo: any, tab: any) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    updateTabContextMatrix();
  }
});

async function updateTabContextMatrix() {
  // Query all standard HTTP browser tabs, not just the active one
  const allTabs = await chrome.tabs.query({ windowType: 'normal' });
  const validTabs = allTabs.filter((t: any) => t.url && t.url.startsWith('http'));



  // Broadcast the live matrix numbers to the React sidepanel UI
chrome.runtime.sendMessage({
    type: 'MATRIX_CONTEXT_PULSE',
    totalTabsCount: allTabs.length,
    indexedCount: validTabs.length,
    tabsMetadata: validTabs.map((t: any) => ({ id: t.id, title: t.title, url: t.url })),
  });
}

chrome.runtime.onMessage.addListener(
  (message: any, _sender: any, sendResponse: (response?: any) => void) => {
    if (!message) {
      return false;
    }

    const allowedTypes = ['TAB_SCRAPED_DATA', 'RUN_LOCAL_INFERENCE', 'PURGE_ALL_DATA', 'RESET_OFFSCREEN'];
    if (!allowedTypes.includes(message.type)) {
      return false;
    }

    void setupOffscreenContext().then(async () => {
      // If inference is requested, scrape visible text from the selected tabs first
      if (message.type === 'RUN_INFERENCE' || message.type === 'RUN_LOCAL_INFERENCE') {
        const targetIds: number[] = message.targetTabIds || [];
        let compiledContextText = '';

        // Dynamic rapid parsing across checked tabs
        for (const tabId of targetIds) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => document.body?.innerText?.slice(0, 1500) ?? '',
            });

            const snippet = results?.[0]?.result;
            if (typeof snippet === 'string' && snippet.trim().length > 0) {
              compiledContextText += `\nSource Tab Content:\n${snippet}\n`;
            }
          } catch (err) {
            console.log(`Skipping special/restricted tab container frame: ${tabId}`);
          }
        }

        // Forward the compiled context along with the user prompt down to the offscreen layer
        chrome.runtime.sendMessage(
          {
            ...message,
            type: message.type === 'RUN_INFERENCE' ? 'RUN_INFERENCE_OFFSCREEN' : 'RUN_LOCAL_INFERENCE_OFFSCREEN',
            context: compiledContextText || 'No active webpage context accessible.',
            prompt: message.prompt ?? message.query,
          },
          (response: any) => {
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }

            sendResponse(response);
          },
        );
        return;
      }

      // Non-inference messages are forwarded as-is
      chrome.runtime.sendMessage(message, (response: any) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        sendResponse(response);
      });
    });

    return true;
  },
);
