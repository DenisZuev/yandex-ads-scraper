/**
 * Content Script for Yandex Ads Scraper Extension
 * Parses advertising blocks from Yandex search result pages
 */

/**
 * YandexAdParser - Main parser class for extracting ad data
 */
class YandexAdParser {
  constructor() {
    // CSS selectors based on real Yandex pages
    this.selectors = {
      title: [
        '.OrganicTitle-Link',
        '.Organic-Title a',
        'h2 a',
        '.title a'
      ],
      url: [
        '.OrganicTitle-Link',
        '.Organic-Url',
        '.path__item',
        'a[href]'
      ],
      description: [
        '.OrganicText',
        '.Organic-Text',
        '.text-container',
        '.snippet'
      ],
      sitelinks: [
        '.OrganicSitelinks',
        '.Sitelinks',
        '.sitelinks-container'
      ]
    };
  }

  /**
   * Find all ad blocks on the page (including individual promo cards from map block)
   * @returns {Element[]} Array of ad block elements
   */
  findAdBlocks() {
    // Primary: old class (still works on some pages)
    let regularAds = Array.from(document.querySelectorAll('.Organic_withAdvLabel'));

    // Fallback: Yandex obfuscated class names like Organic_withadXXXXX
    // Find all Organic elements that contain a "Промо" label
    if (regularAds.length === 0) {
      const allOrganics = Array.from(document.querySelectorAll('[class*="Organic_withad"], [class*="Organic_withadv"]'));
      regularAds = allOrganics;
    }

    // Final fallback: find any element containing "Промо" label text, get parent Organic block
    if (regularAds.length === 0) {
      const promoLabels = Array.from(document.querySelectorAll('[class*="Organicad"], [class*="OrganicAdv"]'))
        .filter(el => el.textContent.trim() === 'Промо');
      const seen = new Set();
      promoLabels.forEach(label => {
        const organic = label.closest('[class*="Organic"]');
        if (organic && !seen.has(organic)) {
          seen.add(organic);
          regularAds.push(organic);
        }
      });
    }
    
    // Find media ads (AdvMedia items)
    const mediaItems = Array.from(document.querySelectorAll('.AdvMedia-Item'));
    
    // Combine regular ads and media ads
    return [...regularAds, ...mediaItems];
  }

  /**
   * Extract structured data from ad element
   * @param {Element} adElement - Ad block element
   * @param {number} index - Position index
   * @returns {Object|null} Structured ad data or null if extraction fails
   */
  extractAdData(adElement, index) {
    try {
      // Media ad
      if (adElement.classList.contains('AdvMedia-Item')) {
        return this.extractAdvMediaData(adElement, index);
      }

      return {
        title: this.extractTitle(adElement),
        url: this.extractUrl(adElement),
        description: this.extractDescription(adElement),
        position: index + 1,
        additionalLinks: this.extractSitelinks(adElement) || []
      };
    } catch (error) {
      console.warn(`Failed to extract ad at position ${index}:`, error);
      return null;
    }
  }

  /**
   * Extract data from media ad (AdvMedia-Item)
   * @param {Element} adElement - AdvMedia-Item element
   * @param {number} index - Position index
   * @returns {Object|null} Structured ad data or null
   */
  extractAdvMediaData(adElement, index) {
    const url = this.extractUrl(adElement);
    let title = null;
    const img = adElement.querySelector('img.Image');
    if (img && img.alt) title = img.alt;
    const link = adElement.querySelector('a.Link');
    if (!title && link) title = link.textContent.trim() || null;
    if (!title) title = 'Медийная реклама';
    return {
      title: title,
      url: url,
      description: null,
      position: index + 1,
      additionalLinks: []
    };
  }

  /**
   * Extract title from ad element
   * @param {Element} adElement - Ad block element
   * @returns {string|null} Ad title or null
   */
  extractTitle(adElement) {
    return this.extractWithFallback(adElement, this.selectors.title);
  }

  /**
   * Extract URL from ad element - tries to get real landing page URL with UTM parameters
   * @param {Element} adElement - Ad block element
   * @returns {string|null} Real landing page URL with all parameters or null
   */
  extractUrl(adElement) {
    const strategies = [
      this._urlFromTitleLink('data-aqoln'),
      this._urlFromTitleLink('data-vnl'),
      this._urlFromAnyLink('data-aqoln'),
      this._urlFromAnyLink('data-vnl'),
      this._urlFromButtonVnl(),
      this._urlFromDataBem(),
      this._urlFromHref()
    ];
    for (const strategy of strategies) {
      const url = strategy.call(this, adElement);
      if (url) return url;
    }
    return null;
  }

  /** Try data-aqoln/data-vnl from title link */
  _urlFromTitleLink(attr) {
    return (adElement) => {
      const selectors = ['.OrganicTitle-Link', '[class*="OrganicTitle-Link"]', 'h2 a'];
      for (const sel of selectors) {
        const link = adElement.querySelector(sel);
        if (!link || !link.dataset[attr === 'data-aqoln' ? 'aqoln' : 'vnl']) continue;
        try {
          const d = JSON.parse(link.getAttribute(attr));
          if (d.noRedirectUrl) return d.noRedirectUrl;
        } catch { /* fall through */ }
      }
      return null;
    };
  }

  /** Try data-aqoln/data-vnl from any link */
  _urlFromAnyLink(attr) {
    return (adElement) => {
      for (const link of adElement.querySelectorAll(`a[${attr}]`)) {
        try {
          const d = JSON.parse(link.getAttribute(attr));
          if (d.noRedirectUrl) return d.noRedirectUrl;
        } catch { /* skip */ }
      }
      return null;
    };
  }

  /** Scan button[data-vnl] for snippetUrl */
  _urlFromButtonVnl() {
    return (adElement) => {
      for (const btn of adElement.querySelectorAll('button[data-vnl]')) {
        try {
          const d = JSON.parse(btn.getAttribute('data-vnl'));
          if (!d.items) continue;
          for (const item of d.items) {
            const fields = item?.reportFeedback?.customMetaFields;
            if (!fields) continue;
            for (const field of fields) {
              if (field.name === 'snippetUrl' && field.value && this.isValidUrl(field.value)) {
                return field.value;
              }
            }
          }
        } catch { /* skip */ }
      }
      return null;
    };
  }

  /** Try data-bem attribute */
  _urlFromDataBem() {
    return (adElement) => {
      for (const link of adElement.querySelectorAll('a[data-bem]')) {
        try {
          const d = JSON.parse(link.getAttribute('data-bem'));
          const url = d?.click?.arguments?.url;
          if (url && this.isValidUrl(url) && !url.includes('yabs.yandex.ru')) return url;
        } catch { /* skip */ }
      }
      return null;
    };
  }

  /** Fallback: extract href directly */
  _urlFromHref() {
    return (adElement) => {
      for (const selector of this.selectors.url) {
        const element = adElement.querySelector(selector);
        if (element && element.href && this.isValidUrl(element.href)) {
          return element.href;
        }
      }
      return null;
    };
  }

  isValidUrl(urlString) {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Extract description from ad element
   * @param {Element} adElement - Ad block element
   * @returns {string|null} Ad description or null
   */
  extractDescription(adElement) {
    const text = this.extractWithFallback(adElement, this.selectors.description);
    // Limit text length to prevent excessive processing
    return text ? text.substring(0, 1000) : null;
  }

  /**
   * Extract sitelinks (additional links) from ad element
   * @param {Element} adElement - Ad block element
   * @returns {Array} Array of sitelink text strings (without URLs)
   */
  extractSitelinks(adElement) {
    const sitelinks = [];
    
    for (const selector of this.selectors.sitelinks) {
      const container = adElement.querySelector(selector);
      if (container) {
        const links = container.querySelectorAll('a');
        links.forEach(link => {
          if (link.textContent) {
            // Сохраняем только текст ссылки, URL не нужен
            sitelinks.push(link.textContent.trim());
          }
        });
        
        if (sitelinks.length > 0) {
          break;
        }
      }
    }
    
    return sitelinks;
  }

  /**
   * Extract text with fallback selectors
   * @param {Element} element - Parent element
   * @param {string[]} selectors - Array of CSS selectors to try
   * @returns {string|null} Extracted text or null
   */
  extractWithFallback(element, selectors) {
    for (const selector of selectors) {
      const found = element.querySelector(selector);
      if (found && found.textContent) {
        return found.textContent.trim();
      }
    }
    return null;
  }
}

/**
 * Inject highlight CSS into the page
 */
function injectHighlightStyles() {
  if (document.getElementById('yandex-ads-scraper-styles')) return;
  const style = document.createElement('style');
  style.id = 'yandex-ads-scraper-styles';
  style.textContent = `
    .yandex-ads-scraper-highlight {
      outline: 2px solid #F8604A !important;
      outline-offset: 2px !important;
      border-radius: 8px !important;
    }
  `;
  document.documentElement.appendChild(style);
}

/**
 * Highlight collected ad elements on the page
 * @param {Element[]} adBlocks - Array of ad block elements to highlight
 */
function highlightCollectedAds(adBlocks) {
  removeHighlights();
  injectHighlightStyles();

  adBlocks.forEach((block, index) => {
    block.classList.add('yandex-ads-scraper-highlight');
    block.setAttribute('data-scraper-index', index);
  });

  console.log(`Highlighted ${adBlocks.length} ad blocks`);
}

/**
 * Remove highlights from all ad elements
 */
function removeHighlights() {
  const highlighted = document.querySelectorAll('.yandex-ads-scraper-highlight');
  highlighted.forEach(element => {
    element.classList.remove('yandex-ads-scraper-highlight');
    element.removeAttribute('data-scraper-index');
  });
  
  console.log(`Removed highlights from ${highlighted.length} elements`);
}

/**
 * Main collection function - orchestrates the ad collection process
 * @returns {Object} Collection result with success status and data
 */
async function collectAdsFromPage() {
  try {
    const parser = new YandexAdParser();
    const adBlocks = parser.findAdBlocks();
    
    console.log(`Found ${adBlocks.length} ad blocks`);
    
    if (adBlocks.length === 0) {
      return {
        success: true,
        data: {
          ads: [],
          metadata: createMetadata(0)
        }
      };
    }

    // Highlight collected ads on the page
    highlightCollectedAds(adBlocks);

    // Extract ad data - collect ALL ads without deduplication
    const ads = adBlocks
      .map((block, index) => parser.extractAdData(block, index))
      .filter(ad => ad !== null);

    console.log(`Successfully collected ${ads.length} ads`);

    return {
      success: true,
      data: {
        ads: ads,
        metadata: createMetadata(ads.length)
      }
    };
  } catch (error) {
    console.error('Ad collection failed:', error);
    return {
      success: false,
      error: getUserFriendlyMessage(error)
    };
  }
}

/**
 * Create metadata for the collection
 * @param {number} adCount - Number of ads collected
 * @returns {Object} Metadata object
 */
function createMetadata(adCount) {
  return {
    collectionTimestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    searchQuery: extractSearchQuery(),
    adCount: adCount
  };
}

/**
 * Extract search query from URL parameters
 * @returns {string} Search query or empty string
 */
function extractSearchQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('text') || params.get('query') || '';
}

/**
 * Extract raw attributes from ad element
 * @param {Element} adElement - Ad block element
 * @returns {Object} Object with cid and fastName
 */

/**
 * Get user-friendly error message
 * @param {Error} error - Error object
 * @returns {string} User-friendly error message
 */
function getUserFriendlyMessage(error) {
  const messages = {
    'PAGE_STRUCTURE': 'Не удалось распознать структуру страницы',
    'EXTRACTION': 'Ошибка при извлечении данных рекламы',
    'DOWNLOAD': 'Ошибка создания файла',
    'PERMISSION': 'Недостаточно прав для выполнения операции',
    'UNKNOWN': 'Произошла неизвестная ошибка'
  };
  
  return messages[error.type] || messages.UNKNOWN;
}

/**
 * Message listener - handles communication with popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'collectAds') {
    collectAdsFromPage()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'removeHighlights') {
    removeHighlights();
    sendResponse({ success: true });
    return true;
  }
});

console.log('Yandex Ads Scraper content script loaded');
