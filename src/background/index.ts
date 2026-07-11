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

chrome.runtime.onMessage.addListener(
  (message: any, _sender: any, sendResponse: (response?: any) => void) => {
    if (!message || (message.type !== 'TAB_SCRAPED_DATA' && message.type !== 'RUN_LOCAL_INFERENCE')) {
      return false;
    }

    void setupOffscreenContext().then(() => {
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