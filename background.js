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

let batchStopRequested = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'batchScrape') {
    batchStopRequested = false;
    runBatchScrape(request.queries, request.domain || 'ya.ru', sendResponse);
    return true; // keep channel open
  }
  if (request.action === 'batchStop') {
    batchStopRequested = true;
    sendResponse({ success: true });
  }
  if (request.action === 'resolveUrls') {
    resolveAllYabsUrls(request.ads).then(ads => {
      ads.forEach(ad => { ad.utmParams = parseUtmParams(ad.url); });
      sendResponse({ ads });
    });
    return true;
  }
});

/**
 * Open a tab for each query, wait for load, collect ads, close tab.
 * Reports progress back to side panel via chrome.runtime.sendMessage.
 */
async function runBatchScrape(queries, domain, sendResponse) {
  batchStopRequested = false;
  const results = [];
  const concurrency = 3;
  let completed = 0;
  let started  = 0;
  const total  = queries.length;

  async function worker() {
    while (started < total && !batchStopRequested) {
      const i = started++;
      const query = queries[i];

      chrome.runtime.sendMessage({
        action: 'batchProgress',
        current: i + 1,
        total,
        query
      }).catch(() => {});

      try {
        const result = await scrapeQuery(query, domain);
        result.ads = await resolveAllYabsUrls(result.ads);
        // Re-parse UTM params after URL resolution
        result.ads.forEach(ad => {
          ad.utmParams = parseUtmParams(ad.url);
        });
        results.push(result);
        chrome.runtime.sendMessage({ action: 'batchResult', result }).catch(() => {});
      } catch (err) {
        console.warn(`Batch scrape failed for "${query}":`, err);
        chrome.runtime.sendMessage({
          action: 'batchResult',
          result: { query, error: err.message, ads: [] }
        }).catch(() => {});
      }

      completed++;
      chrome.runtime.sendMessage({
        action: 'batchProgress',
        current: completed,
        total,
        query: null
      }).catch(() => {});
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  chrome.runtime.sendMessage({
    action: 'batchDone',
    total: results.length,
    stopped: batchStopRequested
  }).catch(() => {});

  sendResponse({ success: true });
}

/**
 * Open a background tab, wait for content script ready, collect ads, close tab.
 */
function scrapeQuery(query, domain) {
  return new Promise((resolve, reject) => {
    const url = `https://${domain}/search/?text=${encodeURIComponent(query)}`;
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

function parseUtmParams(url) {
  if (!url) return null;
  try {
    const params = new URL(url).searchParams;
    const utm = {};
    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    for (const key of keys) {
      const val = params.get(key);
      if (val) utm[key] = val;
    }
    return Object.keys(utm).length > 0 ? utm : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a yabs redirect URL using a background tab.
 * Opens a hidden tab, lets the browser follow the redirect,
 * captures the final URL, then closes the tab.
 */
function resolveYabsViaTab(yabsUrl) {
  return new Promise((resolve) => {
    let tabId = null;
    let settled = false;
    let timer = null;

    function finish(url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
      resolve(url);
    }

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || settled) return;
      if (changeInfo.url && !changeInfo.url.includes('yabs.yandex.ru')) {
        finish(changeInfo.url);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.create({ url: yabsUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        finish(yabsUrl);
        return;
      }
      tabId = tab.id;
    });

    timer = setTimeout(() => finish(yabsUrl), 8000);
  });
}

/**
 * Resolve all yabs URLs in ads using background tabs (3 concurrent).
 */
async function resolveAllYabsUrls(ads) {
  const yabsAds = [];
  ads.forEach((ad, idx) => {
    if (ad.url && ad.url.includes('yabs.yandex.ru')) {
      yabsAds.push({ ad, idx });
    }
  });

  if (yabsAds.length === 0) return ads;

  const concurrency = 3;
  let i = 0;

  async function worker() {
    while (i < yabsAds.length) {
      const cur = i++;
      const { ad } = yabsAds[cur];
      ad.url = await resolveYabsViaTab(ad.url);
      if (ad.additionalLinks) {
        for (const link of ad.additionalLinks) {
          if (typeof link === 'object' && link.url && link.url.includes('yabs.yandex.ru')) {
            link.url = await resolveYabsViaTab(link.url);
          }
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, yabsAds.length) }, () => worker()));
  return ads;
}

console.log('Yandex Ads Scraper background service worker loaded');
