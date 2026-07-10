// Background Service Worker
let isCreating = false;

async function setupOffscreenContext() {
  const offscreenUrl = 'src/offscreen/index.html';
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length > 0) return;
  if (isCreating) return;
  isCreating = true;

  try {
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.LOCAL_STORAGE],
      justification: 'Mounts WebGPU runtime framework cleanly inside a native DOM environment',
    });
  } catch (err) {
    console.error('Failed to spin up offscreen proxy context:', err);
  } finally {
    isCreating = false;
  }
}

chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response?: any) => void) => {
  if (message.type === 'TAB_SCRAPED_DATA' || message.type === 'RUN_LOCAL_INFERENCE') {
    setupOffscreenContext().then(() => {
      chrome.runtime.sendMessage(message, (res: any) => {
        sendResponse(res);
      });
    });
    return true;
  }

  return false;
});
