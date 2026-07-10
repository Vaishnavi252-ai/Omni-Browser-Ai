// Content Script: Tab Text Extraction Pipeline
(() => {
  const rawText = document.body.innerText || '';
  if (!rawText.trim()) return;

  const paragraphs = rawText
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 40 && paragraph.split(' ').length > 6);

  if (paragraphs.length === 0) return;

  const tabPayload = {
    type: 'TAB_SCRAPED_DATA',
    url: window.location.href,
    title: document.title,
    chunks: paragraphs,
  };

  chrome.runtime.sendMessage(tabPayload, () => {
    if (chrome.runtime.lastError) {
      console.warn('[OmniBrowser AI] Sync skipped: Active context panel closed.');
    } else {
      console.log(`[OmniBrowser AI] Indexed ${paragraphs.length} blocks successfully.`);
    }
  });
})();
