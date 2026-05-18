/**
 * Content Script for Yandex Ads Scraper Extension
 * Parses advertising blocks from Yandex search result pages
 */

/**
 * YandexAdParser - Main parser class for extracting ad data
 */
class YandexAdParser {
  constructor() {
    // CSS selectors based on real Yandex pages (from "Примеры выдачи")
    this.selectors = {
      // Primary ad container selectors
      adBlocks: [
        '.serp-item[data-cid]',           // Primary: SERP item with CID attribute
        '.Organic_withAdvLabel',          // Organic block with ad label
        '[data-cid]',                     // Fallback: any element with CID
        '[data-fast-name*="serp-adv"]'    // Legacy: Fast name marker
      ],
      // Map block selectors (Yandex.Business cards)
      mapBlock: '[data-fast-name="companies"]',
      mapCards: '.OrgCard, .CompaniesModal-OrgCard, [class*="OrgCard"]',
      // Ad component selectors
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
      ],
      // Ad label selectors - "Промо" label
      adLabels: [
        '.AdvLabel .AdvLabel-Text',
        '.OrganicAdvLabel .AdvLabel-Text',
        '.AdvLabel',
        '[class*="Label"][class*="Adv"]'
      ],
      // Map card selectors
      mapCardTitle: [
        '.OrgCard-Title',
        '.OrgCard-Name',
        '[class*="OrgCard"][class*="Title"]',
        '[class*="OrgCard"][class*="Name"]'
      ],
      mapCardAddress: [
        '.OrgCard-Address',
        '[class*="OrgCard"][class*="Address"]'
      ],
      mapCardRating: [
        '.OrgCard-Rating',
        '[class*="OrgCard"][class*="Rating"]'
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
   * Find all promotional OrgCards inside Yandex.Business map block
   * @returns {Element[]} Array of promotional OrgCard elements
   */
  findMapAdCards() {
    const mapContainer = document.querySelector(this.selectors.mapBlock);
    if (!mapContainer) {
      return [];
    }
    
    // Find all OrgCards inside the map container
    const allCards = mapContainer.querySelectorAll(this.selectors.mapCards);
    const adCards = [];
    
    for (const card of allCards) {
      // Check if this card has promotional indicators:
      // 1. Has OrgCard-DirectExtension (advertising extension)
      // 2. Contains "Промо" label text
      const isPromoCard = this.isPromoOrgCard(card);
      
      if (isPromoCard) {
        adCards.push(card);
      }
    }
    
    console.log(`Found ${adCards.length} promotional cards in map block out of ${allCards.length} total cards`);
    return adCards;
  }
  
  /**
   * Check if OrgCard is promotional (has "Промо" label)
   * @param {Element} card - OrgCard element
   * @returns {boolean} True if card is promotional
   */
  isPromoOrgCard(card) {
    // Check for DirectExtension (advertising block inside card)
    const directExtension = card.querySelector('.OrgCard-DirectExtension, [class*="DirectExtension"]');
    if (directExtension) {
      return true;
    }
    
    // Check for "Промо" label anywhere in the card
    const labels = card.querySelectorAll('.AdvLabel, .Label, [class*="Label"]');
    for (const label of labels) {
      if (label.textContent && label.textContent.includes('Промо')) {
        return true;
      }
    }
    
    // Check for aria-label containing "реклам" (advertising)
    if (card.getAttribute('aria-label') && card.getAttribute('aria-label').toLowerCase().includes('реклам')) {
      return true;
    }
    
    return false;
  }

  /**
   * Determine if element is an advertisement
   * @param {Element} element - DOM element to check
   * @returns {boolean} True if element is an ad
   */
  isAdvertisement(element) {
    // Old class
    if (element.classList.contains('Organic_withAdvLabel')) return true;
    // New obfuscated class pattern
    if (Array.from(element.classList).some(c => c.startsWith('Organic_withad'))) return true;
    // Has Промо label inside
    const labels = element.querySelectorAll('[class*="Organicad"], [class*="OrganicAdv"]');
    if (Array.from(labels).some(l => l.textContent.trim() === 'Промо')) return true;
    // Media ad
    if (element.classList.contains('AdvMedia-Item')) return true;
    return false;
  }
  
  /**
   * Determine ad type based on position on page or element type
   * @param {Element} element - DOM element to check
   * @returns {string} Ad type
   */


  /**
   * Extract structured data from ad element
   * @param {Element} adElement - Ad block element
   * @param {number} index - Position index
   * @returns {Object|null} Structured ad data or null if extraction fails
   */
  extractAdData(adElement, index) {
    try {
      // Check if this is an OrgCard (map card)
      const isOrgCard = adElement.classList.contains('OrgCard') || 
                        adElement.classList.contains('CompaniesModal-OrgCard') ||
                        Array.from(adElement.classList).some(cls => cls.includes('OrgCard'));
      
      if (isOrgCard) {
        return this.extractMapCardData(adElement, index);
      }

      // Media ad
      if (adElement.classList.contains('AdvMedia-Item')) {
        return this.extractAdvMediaData(adElement, index);
      }
      
      const url = this.extractUrl(adElement);

      return {
        title: this.extractTitle(adElement),
        url: url,
        description: this.extractDescription(adElement),
        position: index + 1,
        additionalLinks: this.extractSitelinks(adElement) || [],
        utmParams: parseUtmParams(url)
      };
    } catch (error) {
      console.warn(`Failed to extract ad at position ${index}:`, error);
      return null;
    }
  }
  
  /**
   * Extract structured data from individual map card (OrgCard with Промо label)
   * @param {Element} cardElement - OrgCard element
   * @param {number} index - Position index
   * @returns {Object|null} Structured map card data or null if extraction fails
   */
  extractMapCardData(cardElement, index) {
    try {
      // Extract title from OrgCard
      let title = null;
      for (const selector of this.selectors.mapCardTitle) {
        const titleElement = cardElement.querySelector(selector);
        if (titleElement && titleElement.textContent) {
          title = titleElement.textContent.trim();
          break;
        }
      }
      
      // Extract URL from OrgCard link
      let url = null;
      const linkElement = cardElement.querySelector('a[href]');
      if (linkElement && linkElement.href) {
        url = linkElement.href;
      }
      
      // Extract description/address from OrgCard
      let description = null;
      for (const selector of this.selectors.mapCardAddress) {
        const addressElement = cardElement.querySelector(selector);
        if (addressElement && addressElement.textContent) {
          description = addressElement.textContent.trim();
          break;
        }
      }
      
      return {
        title: title,
        url: url || 'https://yandex.ru',
        description: description,
        position: index + 1,
        additionalLinks: []
      };
    } catch (error) {
      console.warn(`Failed to extract map card at position ${index}:`, error);
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
      additionalLinks: [],
      utmParams: parseUtmParams(url)
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
    // Try to get noRedirectUrl from title link first (most reliable)
    const titleSelectors = ['.OrganicTitle-Link', '[class*="OrganicTitle-Link"]', 'h2 a'];
    for (const sel of titleSelectors) {
      const link = adElement.querySelector(sel);
      if (!link) continue;
      // Try data-aqoln (Yandex 2025+)
      if (link.dataset.aqoln) {
        try {
          const d = JSON.parse(link.getAttribute('data-aqoln'));
          if (d.noRedirectUrl) return d.noRedirectUrl;
        } catch { /* fall through */ }
      }
      // Try data-vnl (older)
      if (link.dataset.vnl) {
        try {
          const d = JSON.parse(link.getAttribute('data-vnl'));
          if (d.noRedirectUrl) return d.noRedirectUrl;
        } catch { /* fall through */ }
      }
    }

    // Fallback: scan all links with data-aqoln, pick first with noRedirectUrl
    for (const link of adElement.querySelectorAll('a[data-aqoln]')) {
      try {
        const d = JSON.parse(link.getAttribute('data-aqoln'));
        if (d.noRedirectUrl) return d.noRedirectUrl;
      } catch { /* skip */ }
    }

    // Fallback: scan all links with data-vnl
    for (const link of adElement.querySelectorAll('a[data-vnl]')) {
      try {
        const d = JSON.parse(link.getAttribute('data-vnl'));
        if (d.noRedirectUrl) return d.noRedirectUrl;
      } catch { /* skip */ }
    }

    // Scan button[data-vnl] for snippetUrl (reportFeedback customMetaFields)
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

    // Try data-bem attribute (BEM-based Yandex, stores click URL)
    for (const link of adElement.querySelectorAll('a[data-bem]')) {
      try {
        const d = JSON.parse(link.getAttribute('data-bem'));
        const url = d?.click?.arguments?.url;
        if (url && this.isValidUrl(url) && !url.includes('yabs.yandex.ru')) return url;
      } catch { /* skip */ }
    }
    
    // Fallback: try to extract from link href (this will be yabs.yandex.ru redirect URL)
    for (const selector of this.selectors.url) {
      const element = adElement.querySelector(selector);
      if (element && element.href) {
        // Validate URL
        if (this.isValidUrl(element.href)) {
          return element.href;
        }
      }
    }
    
    return null;
  }

  /**
   * Extract URL from data-bem attribute (debug/info-only, not used as primary source)
   * @param {Element} adElement - Ad block element
   * @returns {string|null} URL from data-bem or null
   */

  /**
   * Validate URL
   * @param {string} urlString - URL to validate
   * @returns {boolean} True if URL is valid
   */
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
 * Highlight collected ad elements on the page
 * @param {Element[]} adBlocks - Array of ad block elements to highlight
 */
function highlightCollectedAds(adBlocks) {
  // Remove any existing highlights first
  removeHighlights();
  
  adBlocks.forEach((block, index) => {
    block.classList.add('yandex-ads-scraper-highlight');
    block.setAttribute('data-scraper-index', index);
    block.style.outline = '2px solid #F8604A';
    block.style.outlineOffset = '2px';
    block.style.borderRadius = '8px';
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
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.borderRadius = '';
    // Don't remove position style as it might be set by the page
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
    adCount: adCount,
    userAgent: navigator.userAgent
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
 * Parse UTM parameters from URL
 * @param {string} url - URL to parse
 * @returns {Object|null} Parsed UTM parameters or null
 */
function parseUtmParams(url) {
  if (!url) return null;
  try {
    const params = new URL(url).searchParams;
    const utm = {};
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    for (const key of utmKeys) {
      const val = params.get(key);
      if (val) utm[key] = val;
    }
    return Object.keys(utm).length > 0 ? utm : null;
  } catch {
    return null;
  }
}

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
