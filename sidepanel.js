/**
 * Side Panel Controller for Yandex Ads Scraper
 * Accumulates ads across multiple searches/pages
 */

class SidePanelController {
  constructor() {
    // Manual tab
    this.collectBtn    = document.getElementById('collectBtn');
    this.statusEl      = document.getElementById('status');
    this.notYandex     = document.getElementById('notYandex');

    // Batch tab
    this.batchQueries  = document.getElementById('batchQueries');
    this.batchStartBtn = document.getElementById('batchStartBtn');
    this.batchStopBtn  = document.getElementById('batchStopBtn');
    this.batchStatus   = document.getElementById('batchStatus');
    this.batchProgress = document.getElementById('batchProgress');
    this.progressBar   = document.getElementById('progressBar');
    this.progressText  = document.getElementById('progressText');

    // Shared
    this.totalBadge        = document.getElementById('totalBadge');
    this.sessionsContainer = document.getElementById('sessionsContainer');
    this.sessionsList      = document.getElementById('sessionsList');
    this.sessionsCount     = document.getElementById('sessionsCount');
    this.downloadAllBtn    = document.getElementById('downloadAllBtn');
    this.copyAllBtn        = document.getElementById('copyAllBtn');
    this.csvAllBtn         = document.getElementById('csvAllBtn');
    this.clearAllBtn       = document.getElementById('clearAllBtn');
    this.emptyState        = document.getElementById('emptyState');

    this.sessions    = [];
    this.batchRunning = false;

    this.init();
    this.loadSessions();
  }

  init() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Manual
    this.collectBtn.addEventListener('click', () => this.collectAds());

    // Batch
    this.batchStartBtn.addEventListener('click', () => this.startBatch());
    this.batchStopBtn.addEventListener('click',  () => this.stopBatch());

    // Shared
    this.downloadAllBtn.addEventListener('click', () => this.downloadAll());
    this.copyAllBtn.addEventListener('click',     () => this.copyAllJSON());
    this.csvAllBtn.addEventListener('click',      () => this.downloadAllCSV());
    this.clearAllBtn.addEventListener('click',    () => this.clearAll());

    // Listen for results from background
    chrome.runtime.onMessage.addListener((msg) => this.handleBgMessage(msg));
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${name}`));
  }

  // ── Manual collection ─────────────────────────────────────────────────────

  async collectAds() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url || (!tab.url.includes('ya.ru/search') && !tab.url.includes('yandex.ru/search'))) {
        this.showNotYandex();
        return;
      }

      this.hideNotYandex();
      this.showLoading();

      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'collectAds' });
      } catch {
        this.showStatus('error', 'Перезагрузите страницу (F5) и попробуйте снова');
        return;
      }

      if (!response?.success) {
        this.showStatus('error', response?.error || 'Ошибка при сборе данных');
        return;
      }

      const { ads, metadata } = response.data;

      if (ads.length === 0) {
        this.showStatus('error', 'Реклама не найдена на этой странице');
        return;
      }

      // Resolve yabs redirects to real URLs via background tabs
      let resolvedAds = ads;
      try {
        const res = await chrome.runtime.sendMessage({ action: 'resolveUrls', ads });
        if (res?.ads) resolvedAds = res.ads;
      } catch { /* keep yabs URLs if resolution fails */ }

      this.addSession({
        query:     metadata.searchQuery || tab.title || 'Без запроса',
        pageUrl:   metadata.pageUrl,
        timestamp: metadata.collectionTimestamp,
        ads:       resolvedAds
      });

      this.showStatus('success', `Добавлено ${ads.length} объявл. с этой страницы`);

    } catch (err) {
      console.error(err);
      this.showStatus('error', 'Ошибка. Перезагрузите страницу (F5)');
    }
  }

  // ── Batch collection ──────────────────────────────────────────────────────

  startBatch() {
    const raw = this.batchQueries.value.trim();
    if (!raw) {
      this.showBatchStatus('error', 'Введите хотя бы один запрос');
      return;
    }

    // Parse queries: split by newline, comma, or semicolon
    let queries = raw
      .split(/[\n,;]+/)
      .map(q => q.trim())
      .filter(q => q.length > 0);

    if (queries.length === 0) {
      this.showBatchStatus('error', 'Не удалось распознать запросы');
      return;
    }

    // Deduplicate
    const before = queries.length;
    queries = [...new Set(queries)];
    const dupes = before - queries.length;

    const MAX_BATCH = 50;
    if (queries.length > MAX_BATCH) {
      this.showBatchStatus('error', `Максимум ${MAX_BATCH} запросов за раз. У вас ${queries.length}.`);
      return;
    }

    if (dupes > 0) {
      this.showBatchStatus('loading', `Удалено дубликатов: ${dupes}`);
    }

    this.batchRunning = true;
    this.batchStartBtn.classList.add('hidden');
    this.batchStopBtn.classList.remove('hidden');
    this.batchQueries.disabled = true;
    this.batchProgress.classList.remove('hidden');
    this.updateProgress(0, queries.length, '');
    this.showBatchStatus('loading', `Запускаем ${queries.length} запросов…`);

    chrome.runtime.sendMessage({ action: 'batchScrape', queries, domain: 'ya.ru' }, () => {
      // sendResponse callback — batch finished or error
    });
  }

  stopBatch() {
    chrome.runtime.sendMessage({ action: 'batchStop' }).catch(() => {});
    this.batchRunning = false;
    this.resetBatchUI();
    this.showBatchStatus('error', 'Остановлено');
  }

  handleBgMessage(msg) {
    if (msg.action === 'batchProgress') {
      this.updateProgress(msg.current, msg.total, msg.query);
      if (msg.query) {
        this.showBatchStatus('loading', `${msg.current}/${msg.total}: ${msg.query}`);
      } else {
        this.showBatchStatus('loading', `Обработано ${msg.current}/${msg.total}`);
      }
    }

    if (msg.action === 'batchResult') {
      const r = msg.result;
      if (r.ads && r.ads.length > 0) {
        this.addSession({
          query:     r.query,
          pageUrl:   r.pageUrl,
          timestamp: r.timestamp,
          ads:       r.ads
        });
      }
    }

    if (msg.action === 'batchDone') {
      this.batchRunning = false;
      this.resetBatchUI();
      if (msg.stopped) {
        this.showBatchStatus('error', `Остановлено. Собрано ${msg.total} запросов.`);
      } else {
        this.showBatchStatus('success', `Готово! Собрано ${msg.total} запросов`);
      }
    }
  }

  updateProgress(current, total, query) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    this.progressBar.style.width = `${pct}%`;
    this.progressText.textContent = query ? `${current}/${total} — ${query}` : `${current}/${total}`;
  }

  resetBatchUI() {
    this.batchStartBtn.classList.remove('hidden');
    this.batchStopBtn.classList.add('hidden');
    this.batchQueries.disabled = false;
    setTimeout(() => this.batchProgress.classList.add('hidden'), 2000);
  }

  // ── Domain preference ────────────────────────────────────────────────────


  // ── Persistence ──────────────────────────────────────────────────────────

  async loadSessions() {
    try {
      const data = await chrome.storage.local.get('sessions');
      if (data.sessions && Array.isArray(data.sessions)) {
        this.sessions = data.sessions;
        this.renderSessions();
        this.updateTotals();
      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
    }
  }

  async saveSessions() {
    try {
      await chrome.storage.local.set({ sessions: this.sessions });
      const usage = await chrome.storage.local.getBytesInUse(null);
      const limit = 10 * 1024 * 1024; // 10 MB
      if (usage > limit * 0.8) {
        const pct = Math.round((usage / limit) * 100);
        this.showBatchStatus('error', `Хранилище заполнено на ${pct}%. Очистите старые сессии.`);
      }
    } catch (err) {
      if (err.message && err.message.includes('QUOTA_BYTES')) {
        this.showBatchStatus('error', 'Хранилище переполнено. Очистите старые сессии.');
      }
      console.warn('Failed to save sessions:', err);
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  addSession(session) {
    const existingIdx = this.sessions.findIndex(s => s.query === session.query);
    if (existingIdx !== -1) {
      this.sessions[existingIdx] = session;
    } else {
      this.sessions.unshift(session);
    }
    this.renderSessions();
    this.updateTotals();
    this.saveSessions();
  }

  deleteSession(index) {
    if (!confirm('Удалить эту сессию?')) return;
    this.sessions.splice(index, 1);
    this.renderSessions();
    this.updateTotals();
    this.saveSessions();
    if (this.sessions.length === 0) this.removeHighlightsFromActiveTab();
  }

  clearAll() {
    if (!confirm('Очистить все сессии? Это действие нельзя отменить.')) return;
    this.sessions = [];
    this.renderSessions();
    this.updateTotals();
    this.saveSessions();
    this.removeHighlightsFromActiveTab();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  renderSessions() {
    this.sessionsList.innerHTML = '';

    if (this.sessions.length === 0) {
      this.sessionsContainer.classList.add('hidden');
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');
    this.sessionsContainer.classList.remove('hidden');

    this.sessions.forEach((session, idx) => {
      const card = this.createSessionCard(session, this.sessions.indexOf(session));
      if (idx > 0) card.classList.add('collapsed');
      this.sessionsList.appendChild(card);
    });
  }

  createSessionCard(session, idx) {
    const card = document.createElement('div');
    card.className = 'session-card';

    const header = document.createElement('div');
    header.className = 'session-header';

    const query = document.createElement('div');
    query.className = 'session-query';
    query.textContent = session.query || 'Без запроса';
    query.title = session.query;

    const meta = document.createElement('div');
    meta.className = 'session-meta';

    const countBadge = document.createElement('span');
    countBadge.className = 'session-count-badge';
    countBadge.textContent = session.ads.length;

    const toggle = document.createElement('span');
    toggle.className = 'session-toggle';
    toggle.textContent = '▾';

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn-session-download';
    dlBtn.textContent = 'JSON';
    dlBtn.title = 'Скачать эту сессию (JSON)';
    dlBtn.addEventListener('click', (e) => { e.stopPropagation(); this.downloadSession(session); });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-session-copy';
    copyBtn.textContent = '📋';
    copyBtn.title = 'Копировать JSON в буфер';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); this.copySessionJSON(session); });

    const csvBtn = document.createElement('button');
    csvBtn.className = 'btn-session-csv';
    csvBtn.textContent = 'CSV';
    csvBtn.title = 'Скачать эту сессию (CSV)';
    csvBtn.addEventListener('click', (e) => { e.stopPropagation(); this.downloadSessionCSV(session); });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-session-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteSession(idx); });

    actions.appendChild(copyBtn);
    actions.appendChild(dlBtn);
    actions.appendChild(csvBtn);
    actions.appendChild(delBtn);
    meta.appendChild(countBadge);
    meta.appendChild(toggle);
    meta.appendChild(actions);
    header.appendChild(query);
    header.appendChild(meta);

    header.addEventListener('click', () => card.classList.toggle('collapsed'));

    const body = document.createElement('div');
    body.className = 'session-body';

    session.ads.forEach((ad, i) => {
      body.appendChild(this.createAdItem(ad, i + 1));
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  createAdItem(ad, num) {
    const item = document.createElement('div');
    item.className = 'ad-item';

    const title = document.createElement('div');
    title.className = 'ad-title';
    title.textContent = `${num}. ${ad.title || 'Без названия'}`;

    const url = document.createElement('a');
    url.className = 'ad-url';
    url.href = ad.url || '#';
    url.target = '_blank';
    url.rel = 'noopener noreferrer';
    url.textContent = formatUrl(ad.url);

    item.appendChild(title);
    item.appendChild(url);

    return item;
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  updateTotals() {
    const total = this.sessions.reduce((sum, s) => sum + s.ads.length, 0);

    const domains = new Set();
    this.sessions.forEach(s => {
      s.ads.forEach(ad => {
        if (ad.url) {
          try {
            domains.add(new URL(ad.url).hostname.replace(/^www\./, ''));
          } catch { /* skip invalid */ }
        }
      });
    });

    if (total > 0) {
      this.totalBadge.textContent = total;
      this.totalBadge.classList.remove('hidden');
    } else {
      this.totalBadge.classList.add('hidden');
    }

    const sessionWord = pluralWord(this.sessions.length, 'запрос', 'запроса', 'запросов');
    const adWord      = pluralWord(total, 'объявление', 'объявления', 'объявлений');
    const siteWord    = pluralWord(domains.size, 'сайт', 'сайта', 'сайтов');
    this.sessionsCount.textContent = `${this.sessions.length} ${sessionWord} · ${total} ${adWord} · ${domains.size} ${siteWord}`;
  }

  // ── Download ──────────────────────────────────────────────────────────────

  downloadSession(session) {
    const data = {
      metadata: {
        collectionTimestamp: session.timestamp,
        pageUrl:     session.pageUrl,
        searchQuery: session.query,
        adCount:     session.ads.length
      },
      ads: session.ads
    };
    downloadJSON(data, `yandex-ads-${safeTimestamp(session.timestamp)}.json`);
  }

  copySessionJSON(session) {
    const urls = session.ads.map(ad => ad.url).filter(Boolean).join('\n');
    navigator.clipboard.writeText(urls).catch(() => {});
  }

  downloadSessionCSV(session) {
    const data = {
      sessions: [{
        searchQuery: session.query,
        ads: session.ads
      }]
    };
    downloadCSV(data, `yandex-ads-${safeTimestamp(session.timestamp)}.csv`);
  }

  copyAllJSON() {
    const urls = this.sessions.flatMap(s => s.ads.map(ad => ad.url)).filter(Boolean).join('\n');
    navigator.clipboard.writeText(urls).catch(() => {});
  }

  downloadAll() {
    const totalAds = this.sessions.reduce((sum, s) => sum + s.ads.length, 0);
    const data = {
      metadata: {
        collectionTimestamp: new Date().toISOString(),
        sessionCount: this.sessions.length,
        adCount:      totalAds
      },
      sessions: this.sessions.map(s => ({
        searchQuery: s.query,
        pageUrl:     s.pageUrl,
        timestamp:   s.timestamp,
        adCount:     s.ads.length,
        ads:         s.ads
      }))
    };
    downloadJSON(data, `yandex-ads-all-${safeTimestamp()}.json`);
  }

  downloadAllCSV() {
    const data = {
      sessions: this.sessions.map(s => ({
        searchQuery: s.query,
        ads: s.ads
      }))
    };
    downloadCSV(data, `yandex-ads-all-${safeTimestamp()}.csv`);
  }

  // ── Highlights ────────────────────────────────────────────────────────────

  async removeHighlightsFromActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;
      if (!tab.url.includes('ya.ru/search') && !tab.url.includes('yandex.ru/search')) return;
      await chrome.tabs.sendMessage(tab.id, { action: 'removeHighlights' });
    } catch { /* silent */ }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  showLoading() {
    this.collectBtn.disabled = true;
    this.statusEl.className  = 'status loading';
    this.statusEl.textContent = 'Собираем рекламу…';
    this.statusEl.classList.remove('hidden');
  }

  showStatus(type, text) {
    this.collectBtn.disabled  = false;
    this.statusEl.className   = `status ${type}`;
    this.statusEl.textContent = text;
    this.statusEl.classList.remove('hidden');
    if (type === 'success') setTimeout(() => this.statusEl.classList.add('hidden'), 3000);
  }

  showBatchStatus(type, text) {
    this.batchStatus.className   = `status ${type}`;
    this.batchStatus.textContent = text;
    this.batchStatus.classList.remove('hidden');
    if (type === 'success') setTimeout(() => this.batchStatus.classList.add('hidden'), 4000);
  }

  showNotYandex() {
    this.collectBtn.disabled = false;
    this.statusEl.classList.add('hidden');
    this.notYandex.classList.remove('hidden');
  }

  hideNotYandex() {
    this.notYandex.classList.add('hidden');
  }

}

document.addEventListener('DOMContentLoaded', () => new SidePanelController());
