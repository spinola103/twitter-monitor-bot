// twitter-fresh-scraper.js
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 🔥 BROWSER POOL MANAGEMENT
class BrowserPool {
  constructor() {
    this.browser = null;
    this.pages = new Set();
    this.maxPages = 3;
    this.isInitializing = false;
    this.lastHealthCheck = Date.now();
    this.cookiesLoaded = false;
    this.cookieValidation = { isValid: false, message: '' };

    setInterval(() => this.healthCheck(), 5 * 60 * 1000);
  }

  async initialize() {
    if (this.isInitializing) {
      console.log('⏳ Browser initialization already in progress...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return this.browser;
    }

    if (this.browser && !this.browser.isConnected()) {
      console.log('🔄 Browser disconnected, reinitializing...');
      this.browser = null;
    }

    if (this.browser) {
      console.log('✅ Reusing existing browser instance');
      return this.browser;
    }

    this.isInitializing = true;

    try {
      const chromePath = findChrome();

      const launchOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--single-process',
          '--max_old_space_size=512',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--window-size=1366,768',
          '--memory-pressure-off',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--user-data-dir=/tmp/chrome-pool-data'
        ],
        defaultViewport: { width: 1366, height: 768 }
      };

      if (chromePath) {
        launchOptions.executablePath = chromePath;
      }

      console.log('🚀 Launching new browser instance...');
      this.browser = await puppeteer.launch(launchOptions);

      this.browser.on('disconnected', () => {
        console.log('🔴 Browser disconnected, will reinitialize on next request');
        this.browser = null;
        this.pages.clear();
        this.cookiesLoaded = false;
        this.cookieValidation = { isValid: false, message: '' };
      });

      console.log('✅ Browser pool initialized successfully');
      this.lastHealthCheck = Date.now();
    } catch (error) {
      console.error('💥 Failed to initialize browser:', error.message);
      this.browser = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }

    return this.browser;
  }

  async getPage() {
    const browser = await this.initialize();

    if (this.pages.size >= this.maxPages) {
      console.log('⚠️ Max pages reached, waiting for available page...');
      while (this.pages.size >= this.maxPages) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const page = await browser.newPage();
    this.pages.add(page);

    // Configure page
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1'
    });

    // Clear storage on new page
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
    });

    // Load and validate cookies (improved)
    if (!this.cookiesLoaded && process.env.TWITTER_COOKIES) {
      await this.loadCookies(page);
    }

    console.log(`📄 Created new page (${this.pages.size}/${this.maxPages} active)`);
    return page;
  }

  // Improved cookie loading: navigate first so domain/app context is correct
  async loadCookies(page) {
    try {
      if (!process.env.TWITTER_COOKIES) {
        this.cookieValidation = { isValid: false, message: 'No TWITTER_COOKIES environment variable found' };
        return false;
      }

      let cookies;

      if (process.env.TWITTER_COOKIES.trim().startsWith('[') || process.env.TWITTER_COOKIES.trim().startsWith('{')) {
        cookies = JSON.parse(process.env.TWITTER_COOKIES);
      } else {
        this.cookieValidation = { isValid: false, message: 'TWITTER_COOKIES must be valid JSON array or object' };
        console.log('⚠️ TWITTER_COOKIES appears to be in invalid format');
        return false;
      }

      if (!Array.isArray(cookies)) {
        if (typeof cookies === 'object' && cookies.name) {
          cookies = [cookies];
        } else {
          this.cookieValidation = { isValid: false, message: 'TWITTER_COOKIES must be an array of cookie objects' };
          return false;
        }
      }

      const validCookies = cookies.filter(cookie =>
        cookie.name && cookie.value && (cookie.domain || cookie.url)
      );

      if (validCookies.length === 0) {
        this.cookieValidation = { isValid: false, message: 'No valid cookies found (need name, value, domain or url)' };
        return false;
      }

      // Navigate to x.com first to ensure correct context
      try {
        await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch (e) {
        // not fatal, continue
      }

      // Normalize cookies: ensure cookie objects have url or domain; if not, set url to https://x.com
      const normalized = validCookies.map(c => {
        const copy = Object.assign({}, c);
        if (!copy.url && !copy.domain) {
          copy.url = 'https://x.com';
        }
        // remove sameSite if it's invalid for puppeteer
        if (copy.sameSite && typeof copy.sameSite === 'string') {
          copy.sameSite = copy.sameSite.toLowerCase();
        }
        return copy;
      });

      // set cookies
      await page.setCookie(...normalized);

      // Quick validation: ensure essential cookie names exist
      const essentialCookieNames = ['auth_token', 'ct0', 'twid'];
      const foundEssential = essentialCookieNames.some(name =>
        normalized.find(cookie => cookie.name === name)
      );

      this.cookiesLoaded = true;
      this.cookieValidation = {
        isValid: foundEssential,
        message: foundEssential ? `Successfully loaded ${normalized.length} cookies` : `Cookies loaded (${normalized.length}) but essential cookies missing: ${essentialCookieNames.join(', ')}`
      };

      console.log(`✅ ${normalized.length} cookies loaded to browser pool`);
      return foundEssential;

    } catch (err) {
      this.cookieValidation = { isValid: false, message: `Cookie loading error: ${err.message}` };
      console.error('❌ Cookie loading failed:', err.message);
      return false;
    }
  }

  async releasePage(page) {
    if (!page || !this.pages.has(page)) return;

    try {
      await page.close();
    } catch (e) {
      console.error('Error closing page:', e.message);
    }

    this.pages.delete(page);
    console.log(`📄 Released page (${this.pages.size}/${this.maxPages} active)`);
  }

  async healthCheck() {
    if (!this.browser) return;

    try {
      const version = await this.browser.version();
      console.log(`💊 Health check passed - Browser version: ${version}`);
      this.lastHealthCheck = Date.now();

      if (this.pages.size > 1) {
        console.log('🧹 Cleaning up idle pages...');
        const pageArray = Array.from(this.pages);
        for (let i = 1; i < pageArray.length; i++) {
          await this.releasePage(pageArray[i]);
        }
      }

    } catch (error) {
      console.error('💥 Health check failed:', error.message);
      await this.restart();
    }
  }

  async restart() {
    console.log('🔄 Restarting browser pool...');

    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch (e) {
      console.error('Error closing browser during restart:', e.message);
    }

    this.browser = null;
    this.pages.clear();
    this.cookiesLoaded = false;
    this.cookieValidation = { isValid: false, message: '' };

    await this.initialize();
  }

  getStats() {
    return {
      browser_connected: this.browser?.isConnected() || false,
      active_pages: this.pages.size,
      max_pages: this.maxPages,
      cookies_loaded: this.cookiesLoaded,
      cookie_validation: this.cookieValidation,
      last_health_check: new Date(this.lastHealthCheck).toISOString(),
      uptime_minutes: Math.round((Date.now() - this.lastHealthCheck) / 60000)
    };
  }
}

// Global browser pool instance
const browserPool = new BrowserPool();

function findChrome() {
  const possiblePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    process.env.PUPPETEER_EXECUTABLE_PATH
  ].filter(Boolean);

  for (const path of possiblePaths) {
    if (fs.existsSync(path)) {
      console.log(`✅ Found Chrome at: ${path}`);
      return path;
    }
  }

  console.log('⚠️ No Chrome executable found, using default');
  return null;
}

app.get('/', (req, res) => {
  const chromePath = findChrome();
  const stats = browserPool.getStats();

  res.json({
    status: 'Twitter Fresh Tweet Scraper - BROWSER POOL OPTIMIZED',
    chrome: chromePath || 'default',
    browser_pool: stats,
    timestamp: new Date().toISOString()
  });
});

app.post('/restart-browser', async (req, res) => {
  try {
    await browserPool.restart();
    res.json({
      success: true,
      message: 'Browser pool restarted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * SCRAPE endpoint - focused on freshest tweets
 *
 * Improvements:
 * - Retry loop that checks the top-most article timestamp and forces reload/scrolls
 * - Prefer article[data-testid="tweet"] and better waiting
 * - Cookie loading is done on page creation (loaded earlier)
 */
// ------------------- REPLACE your existing /scrape handler with this -------------------
app.post('/scrape', async (req, res) => {
  const originalURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = req.body.maxTweets || 10;
  const maxAttempts = typeof req.body.maxAttempts === 'number' ? req.body.maxAttempts : 4;
  const freshWindowHours = typeof req.body.freshWindowHours === 'number' ? req.body.freshWindowHours : 48;

  if (!originalURL) return res.status(400).json({ error: 'No Twitter URL provided' });

  // helper to extract username from profile URL: https://x.com/username
  const usernameFromProfile = (url) => {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length === 1) return parts[0];
      return null;
    } catch (e) { return null; }
  };

  let page;
  const startTime = Date.now();
  try {
    page = await browserPool.getPage();
    console.log(`⚡ Got page from pool in ${Date.now() - startTime}ms`);

    await page.bringToFront().catch(()=>{});
    let targetURL = originalURL;
    const profileUsername = usernameFromProfile(originalURL);

    // utility: attempt to click a "Latest" tab/button if present (robust search by text)
    async function clickLatestIfExists() {
      try {
        const clicked = await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, div, span'));
          for (const n of nodes) {
            const t = (n.innerText || '').trim().toLowerCase();
            if (!t) continue;
            if (t === 'latest' || t.includes('latest')) {
              n.click();
              return true;
            }
            // localized / small variations
            if (t === 'latest tweets' || t === 'show latest') {
              n.click();
              return true;
            }
          }
          return false;
        });
        if (clicked) {
          console.log('🖱️ Clicked "Latest" tab/button');
          await page.waitForTimeout(1200);
        }
        return clicked;
      } catch (e) {
        console.warn('clickLatestIfExists error', e?.message || e);
        return false;
      }
    }

    // Try up to maxAttempts to get a fresh top tweet on the initial page
    let attempt = 0;
    let topTimestampISO = null;
    let navigationSuccess = false;

    while (attempt < maxAttempts) {
      attempt++;
      console.log(`🔁 Attempt ${attempt} to load freshest timeline at ${targetURL}`);

      // navigate (domcontentloaded for SPA friendliness)
      await page.goto(targetURL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.warn('goto warning', e?.message));
      await page.setExtraHTTPHeaders({ 'pragma': 'no-cache', 'cache-control': 'no-cache' }).catch(()=>{});
      // clear client caches in page context (may noop if not available)
      await page.evaluate(() => {
        try { if (window.caches) { caches.keys().then(keys => keys.forEach(k => caches.delete(k))); } } catch (e) {}
      }).catch(()=>{});

      // wait briefly for tweet nodes to appear
      const tweetSelector = 'article[data-testid="tweet"], article[role="article"]';
      try {
        await page.waitForSelector(tweetSelector, { timeout: 12000 });
      } catch (e) {
        console.log('⏳ tweet nodes not ready yet, will reload/scroll');
      }

      // try to click "Latest" if available
      await clickLatestIfExists();

      // wiggle scroll to trigger dynamic fetch
      await page.evaluate(() => { window.scrollTo(0, 0); window.scrollBy(0, 150); window.scrollTo(0, 0); });
      await page.waitForTimeout(1000);

      // try a light reload (domcontentloaded)
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
      await page.waitForTimeout(1200);

      // read top-most tweet timestamp (if exists)
      const topInfo = await page.evaluate(() => {
        const first = document.querySelector('article[data-testid="tweet"], article[role="article"]');
        if (!first) return null;
        const timeEl = first.querySelector('time[datetime], time');
        return timeEl ? { iso: timeEl.getAttribute('datetime') || null, text: timeEl.innerText || '' } : null;
      });

      if (topInfo && topInfo.iso) {
        topTimestampISO = topInfo.iso;
        const ageHours = (Date.now() - new Date(topTimestampISO).getTime()) / (1000*60*60);
        console.log(`🔎 Top tweet timestamp: ${topTimestampISO} (age: ${ageHours.toFixed(2)} hours)`);
        if (ageHours <= freshWindowHours) {
          navigationSuccess = true;
          break;
        } else {
          console.log('✳️ Top tweet too old; will retry (or fallback to live-search)');
          // small wait then retry
          await page.waitForTimeout(800);
          continue;
        }
      } else {
        console.log('⚠️ No time element on top article; retrying/scrolling');
        await page.waitForTimeout(800);
        continue;
      }
    } // end attempts loop

    // If still not fresh and we have a profile username, switch to the live-search URL
    if (!navigationSuccess && profileUsername) {
      const searchLive = `https://x.com/search?q=from%3A${encodeURIComponent(profileUsername)}&f=live`;
      console.log('🔄 Falling back to search=f=live URL:', searchLive);
      targetURL = searchLive;

      await page.goto(targetURL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{});
      await page.waitForSelector('article[data-testid="tweet"], article[role="article"]', { timeout: 15000 }).catch(()=>{});
      await page.waitForTimeout(900);
    }

    // FINAL extraction (newest first)
    console.log('🎯 Extracting tweets from page:', await page.url().catch(()=>'(urlfail)'));
    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article[role="article"]'));
      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];
        try {
          // skip promos
          if (article.innerText.toLowerCase().includes('promoted') || article.querySelector('[data-testid="placementTracking"]')) continue;

          // text
          const textSel = ['[data-testid="tweetText"]','div[lang]','div[dir="auto"]','span[dir="ltr"]'];
          let text = '';
          for (const s of textSel) {
            const el = article.querySelector(s);
            if (el && el.innerText && el.innerText.trim().length > 5) { text = el.innerText.trim(); break; }
          }
          if (!text) {
            const lines = (article.innerText||'').split('\n').map(l=>l.trim()).filter(l=>l && l.length>5 && !/^\d+[smhd]$/.test(l));
            if (lines.length) text = lines.join(' / ').slice(0,1000);
          }
          const hasMedia = !!article.querySelector('img[src*="media"], video, [data-testid="videoPlayer"]');
          if (!text && !hasMedia) continue;

          // link & id
          let link=null, id=null;
          const anchors = Array.from(article.querySelectorAll('a[href*="/status/"]'));
          for (const a of anchors) {
            const href = a.getAttribute('href');
            if (href && href.includes('/status/')) {
              link = href.startsWith('http') ? href : 'https://x.com'+href;
              const m = href.match(/status\/(\d+)/);
              if (m) { id = m[1]; break; }
            }
          }
          if (!link || !id) continue;

          // time
          const tEl = article.querySelector('time[datetime], time');
          const ts = tEl ? (tEl.getAttribute('datetime') || new Date().toISOString()) : new Date().toISOString();

          // username/display
          let username='unknown', display='unknown';
          try {
            const parts = link.split('/');
            if (parts.length>=4) username = parts[3].replace(/^@/,'') || username;
          } catch(e){}
          const nameEl = article.querySelector('[data-testid="User-Name"] span, [data-testid="User-Names"] span, div[dir="ltr"] span');
          if (nameEl && nameEl.textContent) display = nameEl.textContent.trim();

          // metrics extract helper
          const getMetric = (patterns) => {
            for (const p of patterns) {
              const els = article.querySelectorAll(p);
              for (const el of els) {
                const ar = el.getAttribute('aria-label') || '';
                const txt = el.textContent || '';
                const combined = (ar+' '+txt).toLowerCase();
                const m = combined.match(/(\d+(?:[,\s]\d+)*)/);
                if (m) return parseInt(m[1].replace(/[,\s]/g,''));
              }
            }
            return 0;
          };

          tweetData.push({
            id,
            username,
            displayName: display,
            text: text || (hasMedia? '(media)' : ''),
            link,
            likes: getMetric(['[data-testid="like"]','[aria-label*="like"]']),
            retweets: getMetric(['[data-testid="retweet"]','[aria-label*="repost"]']),
            replies: getMetric(['[data-testid="reply"]','[aria-label*="repl"]']),
            timestamp: ts,
            relativeTime: (tEl ? (tEl.innerText||'') : ''),
            scraped_at: new Date().toISOString()
          });
        } catch (e) { /* swallow per-article errors */ }
      }
      return tweetData;
    }, maxTweets);

    // sort newest-first and pick final slice
    tweets.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
    const now = new Date();
    const freshCut = new Date(now.getTime() - freshWindowHours*60*60*1000);
    const fresh = tweets.filter(t => new Date(t.timestamp) > freshCut || /[smh]/i.test(t.relativeTime || '') );
    const final = (fresh.length >= maxTweets) ? fresh.slice(0, maxTweets) : tweets.slice(0, maxTweets);

    const totalTime = Date.now() - startTime;
    console.log(`🎉 SUCCESS: Extracted ${final.length} tweets in ${totalTime}ms`);

    res.json({
      success: true,
      count: final.length,
      requested: maxTweets,
      tweets: final,
      scraped_at: new Date().toISOString(),
      profile_url: originalURL,
      performance: { total_time_ms: totalTime, browser_reused: true },
      browser_pool: browserPool.getStats()
    });

  } catch (error) {
    console.error('💥 SCRAPING FAILED:', error.message);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: { total_time_ms: totalTime, browser_reused: true },
      browser_pool: browserPool.getStats(),
      suggestion: browserPool.cookieValidation?.message || 'Try search=f=live or revalidate cookies'
    });
  } finally {
    if (page) await browserPool.releasePage(page);
  }
});
// --------------------------------------------------------------------------------------


// Initialize browser pool on startup
async function startServer() {
  try {
    console.log('🔥 Initializing browser pool...');
    await browserPool.initialize();

    // Validate cookies immediately on startup (improved: navigates before setting cookies)
    if (process.env.TWITTER_COOKIES) {
      console.log('🔍 Validating Twitter cookies...');
      const tempPage = await browserPool.getPage();
      // loadCookies already tries goto('https://x.com')
      await browserPool.releasePage(tempPage);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Twitter Scraper API running on port ${PORT}`);
      console.log(`🔍 Chrome executable:`, findChrome() || 'default');
      console.log(`🍪 Cookies configured:`, !!process.env.TWITTER_COOKIES);
      if (process.env.TWITTER_COOKIES) {
        console.log(`🍪 Cookie validation: ${browserPool.cookieValidation.message || 'Not validated yet'}`);
        console.log(`🍪 Cookie status: ${browserPool.cookieValidation.isValid ? '✅ Valid' : '❌ Invalid/Incomplete'}`);
      }
      console.log(`🔥 Browser pool ready - optimized for FRESH tweets!`);
    });
  } catch (error) {
    console.error('💥 Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (browserPool.browser) {
    await browserPool.browser.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  if (browserPool.browser) {
    await browserPool.browser.close();
  }
  process.exit(0);
});

// Start the server
startServer();
