/**
 * Popup Controller for Yandex Ads Scraper Extension
 * Manages UI state and communication with content script
 */

class PopupController {
  constructor() {
    this.collectBtn = document.getElementById('collectBtn');
    this.statusEl = document.getElementById('status');
    this.resultEl = document.getElementById('result');
    this.previewSection = document.getElementById('previewSection');
    this.previewList = document.getElementById('previewList');
    this.downloadBtn = document.getElementById('downloadBtn');
    this.cancelBtn = document.getElementById('cancelBtn');
    
    this.collectedData = null;
    
    this.init();
  }

  /**
   * Initialize event listeners
   */
  init() {
    this.collectBtn.addEventListener('click', () => this.collectAds());
    this.downloadBtn.addEventListener('click', () => this.downloadData());
    this.cancelBtn.addEventListener('click', () => this.cancelPreview());
  }

  /**
   * Main collection function - sends message to content script
   */
  async collectAds() {
    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Check if we're on a Yandex search page
      if (!tab || !tab.url || (!tab.url.includes('ya.ru/search') && !tab.url.includes('yandex.ru/search'))) {
        this.showError('Откройте страницу поиска Яндекса');
        return;
      }

      // Show loading state
      this.showLoading();

      // Send message to content script with explicit lastError check
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'collectAds' });
      } catch (err) {
        // Content script not loaded - ask user to reload the page
        this.showError('Перезагрузите страницу (F5) и попробуйте снова');
        return;
      }

      // Check for runtime errors
      if (chrome.runtime.lastError) {
        this.showError('Перезагрузите страницу (F5) и попробуйте снова');
        return;
      }

      // Handle response
      if (!response) {
        this.showError('Нет ответа от страницы. Перезагрузите страницу (F5)');
        return;
      }

      if (response.success) {
        const adCount = response.data.ads.length;
        
        if (adCount === 0) {
          this.showEmpty();
        } else {
          // Store data and show preview
          this.collectedData = response.data;
          this.showPreview(response.data.ads);
        }
      } else {
        this.showError(response.error || 'Произошла ошибка при сборе данных');
      }
    } catch (error) {
      console.error('Collection error:', error);
      this.showError('Ошибка. Перезагрузите страницу (F5) и попробуйте снова');
    }
  }

  /**
   * Show preview of collected ads
   * @param {Array} ads - Array of ad objects
   */
  showPreview(ads) {
    this.collectBtn.disabled = false;
    this.statusEl.classList.add('hidden');
    this.resultEl.classList.add('hidden');
    
    // Clear previous preview
    this.previewList.innerHTML = '';
    
    // Group ads by type
    const specAds = ads.filter(ad => ad.adType === 'спецразмещение');
    const guaranteeAds = ads.filter(ad => ad.adType === 'гарантия');
    const businessAds = ads.filter(ad => ad.adType === 'яндекс.бизнес');
    
    // Create "Спецразмещение" section
    if (specAds.length > 0) {
      const specSection = document.createElement('div');
      specSection.className = 'preview-section-group';
      
      const specHeader = document.createElement('h3');
      specHeader.className = 'preview-section-header';
      specHeader.textContent = `Спецразмещение (${specAds.length})`;
      specSection.appendChild(specHeader);
      
      specAds.forEach((ad, index) => {
        specSection.appendChild(this.createAdItem(ad, index + 1, 'spec'));
      });
      
      this.previewList.appendChild(specSection);
    }
    
    // Create "Яндекс.Бизнес" section
    if (businessAds.length > 0) {
      const businessSection = document.createElement('div');
      businessSection.className = 'preview-section-group';
      
      const businessHeader = document.createElement('h3');
      businessHeader.className = 'preview-section-header';
      businessHeader.textContent = `Яндекс.Бизнес (${businessAds.length})`;
      businessSection.appendChild(businessHeader);
      
      businessAds.forEach((ad, index) => {
        businessSection.appendChild(this.createAdItem(ad, index + 1, 'business'));
      });
      
      this.previewList.appendChild(businessSection);
    }
    
    // Create "Гарантия" section
    if (guaranteeAds.length > 0) {
      const guaranteeSection = document.createElement('div');
      guaranteeSection.className = 'preview-section-group';
      
      const guaranteeHeader = document.createElement('h3');
      guaranteeHeader.className = 'preview-section-header';
      guaranteeHeader.textContent = `Гарантия (${guaranteeAds.length})`;
      guaranteeSection.appendChild(guaranteeHeader);
      
      guaranteeAds.forEach((ad, index) => {
        guaranteeSection.appendChild(this.createAdItem(ad, index + 1, 'guarantee'));
      });
      
      this.previewList.appendChild(guaranteeSection);
    }
    
    this.previewSection.classList.remove('hidden');
  }

  /**
   * Create ad item element
   * @param {Object} ad - Ad object
   * @param {number} index - Index within section
   * @param {string} type - 'spec', 'business', or 'guarantee'
   * @returns {HTMLElement} Ad item element
   */
  createAdItem(ad, index, type) {
    const item = document.createElement('div');
    item.className = `preview-item preview-item-${type}`;
    
    const title = document.createElement('div');
    title.className = 'preview-title';
    title.textContent = `${index}. ${ad.title || 'Без названия'}`;
    
    const url = document.createElement('a');
    url.className = 'preview-url';
    url.href = ad.url || '#';
    url.target = '_blank';
    url.rel = 'noopener noreferrer';
    url.textContent = this.formatUrl(ad.url) || 'нет ссылки';
    
    item.appendChild(title);
    item.appendChild(url);
    
    return item;
  }

  /**
   * Download collected data as JSON
   */
  async downloadData() {
    if (!this.collectedData) return;
    
    this.downloadJSON(this.collectedData, this.generateFilename());
    this.showResult(this.collectedData.ads.length);
    this.previewSection.classList.add('hidden');
    
    // Remove highlights after download
    await this.removeHighlights();
  }

  /**
   * Cancel preview and return to initial state
   */
  async cancelPreview() {
    this.collectedData = null;
    this.previewSection.classList.add('hidden');
    this.resultEl.classList.add('hidden');
    
    // Remove highlights when canceling
    await this.removeHighlights();
  }

  /**
   * Remove highlights from the page
   */
  async removeHighlights() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      // Only try to send message if we're on a Yandex search page
      if (!tab.url || (!tab.url.includes('ya.ru/search') && !tab.url.includes('yandex.ru/search'))) return;
      await chrome.tabs.sendMessage(tab.id, { action: 'removeHighlights' });
    } catch (error) {
      // Silently ignore - content script may not be loaded
    }
  }

  /**
   * Format URL for display — show domain only, append /?utm… if UTM params present
   * @param {string} url - Full URL
   * @returns {string} Formatted URL for display
   */
  formatUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  /**
   * Show loading state
   */
  showLoading() {
    this.collectBtn.disabled = true;
    this.statusEl.className = 'status loading';
    this.statusEl.textContent = 'Собираем рекламу...';
    this.statusEl.classList.remove('hidden');
    this.resultEl.classList.add('hidden');
    this.previewSection.classList.add('hidden');
  }

  /**
   * Show success result with ad count
   * @param {number} count - Number of ads collected
   */
  showResult(count) {
    this.collectBtn.disabled = false;
    this.statusEl.classList.add('hidden');
    this.resultEl.className = 'result success';
    this.resultEl.textContent = `Собрано объявлений: ${this.sanitizeText(count.toString())}`;
    this.resultEl.classList.remove('hidden');
  }

  /**
   * Show empty result (no ads found)
   */
  showEmpty() {
    this.collectBtn.disabled = false;
    this.statusEl.classList.add('hidden');
    this.resultEl.className = 'result empty';
    this.resultEl.textContent = 'Реклама не найдена';
    this.resultEl.classList.remove('hidden');
  }

  /**
   * Show error message
   * @param {string} message - Error message to display
   */
  showError(message) {
    this.collectBtn.disabled = false;
    this.statusEl.classList.add('hidden');
    this.resultEl.className = 'result error';
    this.resultEl.textContent = this.sanitizeText(message);
    this.resultEl.classList.remove('hidden');
    this.previewSection.classList.add('hidden');
  }

  /**
   * Sanitize text to prevent XSS
   * @param {string} text - Text to sanitize
   * @returns {string} Sanitized text
   */
  sanitizeText(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Generate filename with timestamp
   * @returns {string} Filename in format yandex-ads-YYYY-MM-DDTHH-MM-SS.json
   */
  generateFilename() {
    const timestamp = new Date().toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    return `yandex-ads-${timestamp}.json`;
  }

  /**
   * Download JSON data as file
   * @param {Object} data - Data to download
   * @param {string} filename - Name of the file
   */
  downloadJSON(data, filename) {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Initialize popup controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
