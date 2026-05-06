/**
 * Background Service Worker for Yandex Ads Scraper Extension
 */

// Open side panel when user clicks the extension icon
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

// ── Batch scraping coordinator ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'batchScrape') {
    runBatchScrape(request.queries, sendResponse);
    return true; // keep channel open
  }
});

/**
 * Open a tab for each query, wait for load, collect ads, close tab.
 * Reports progress back to side panel via chrome.runtime.sendMessage.
 */
async function runBatchScrape(queries, sendResponse) {
  const results = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    // Notify panel: starting this query
    chrome.runtime.sendMessage({
      action: 'batchProgress',
      current: i + 1,
      total: queries.length,
      query
    }).catch(() => {});

    try {
      const result = await scrapeQuery(query);
      results.push(result);

      // Notify panel: got data for this query
      chrome.runtime.sendMessage({
        action: 'batchResult',
        result
      }).catch(() => {});

    } catch (err) {
      console.warn(`Batch scrape failed for "${query}":`, err);
      chrome.runtime.sendMessage({
        action: 'batchResult',
        result: { query, error: err.message, ads: [] }
      }).catch(() => {});
    }
  }

  // All done
  chrome.runtime.sendMessage({
    action: 'batchDone',
    total: results.length
  }).catch(() => {});

  sendResponse({ success: true });
}

/**
 * Open a background tab, wait for content script ready, collect ads, close tab.
 */
function scrapeQuery(query) {
  return new Promise((resolve, reject) => {
    const url = `https://ya.ru/search/?text=${encodeURIComponent(query)}`;
    let tabId = null;
    let settled = false;
    let loadTimeout = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (tabId !== null) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
      resolve(result);
    }

    function fail(msg) {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (tabId !== null) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
      reject(new Error(msg));
    }

    async function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status !== 'complete') return;

      // Page loaded — wait a bit for content script to initialize
      await sleep(1500);

      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'collectAds' });
        if (response && response.success) {
          finish({
            query,
            pageUrl: response.data.metadata.pageUrl,
            timestamp: response.data.metadata.collectionTimestamp,
            ads: response.data.ads
          });
        } else {
          finish({ query, pageUrl: url, timestamp: new Date().toISOString(), ads: [] });
        }
      } catch (err) {
        // Content script not ready — try once more after extra delay
        await sleep(2000);
        try {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'collectAds' });
          if (response && response.success) {
            finish({
              query,
              pageUrl: response.data.metadata.pageUrl,
              timestamp: response.data.metadata.collectionTimestamp,
              ads: response.data.ads
            });
          } else {
            finish({ query, pageUrl: url, timestamp: new Date().toISOString(), ads: [] });
          }
        } catch {
          finish({ query, pageUrl: url, timestamp: new Date().toISOString(), ads: [] });
        }
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    // Create tab in background (not active)
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        fail(chrome.runtime.lastError.message);
        return;
      }
      tabId = tab.id;

      // Safety timeout: 15 seconds max per query
      loadTimeout = setTimeout(() => fail('Timeout'), 15000);
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

console.log('Yandex Ads Scraper background service worker loaded');
