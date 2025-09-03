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
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = req.body.maxTweets || 10;
  const maxAttempts = typeof req.body.maxAttempts === 'number' ? req.body.maxAttempts : 4; // retries to get freshest top tweet
  const freshWindowHours = typeof req.body.freshWindowHours === 'number' ? req.body.freshWindowHours : 48; // how recent a top tweet must be to be considered "fresh"

  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  let page;
  const startTime = Date.now();

  try {
    page = await browserPool.getPage();
    console.log(`⚡ Got page from pool in ${Date.now() - startTime}ms`);

    // Bring to front (helps some remote/headless situations)
    try { await page.bringToFront(); } catch (e) {}

    console.log('🌐 Navigating to:', searchURL);

    // We'll attempt multiple times to ensure the top-most tweet is recent
    let attempt = 0;
    let navigationSuccess = false;
    let topTimestampISO = null;

    while (attempt < maxAttempts) {
      attempt++;
      console.log(`🔁 Attempt ${attempt} to load freshest timeline...`);

      try {
        // Use domcontentloaded first (faster), then ensure tweet selectors exist
        const response = await page.goto(searchURL, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        // If we got a redirect to login, throw early
        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
          throw new Error('❌ Redirected to login page - Check your cookies configuration');
        }

        // Wait for at least one tweet article element (prefer data-testid)
        const tweetSelector = 'article[data-testid="tweet"], article[role="article"]';
        try {
          await page.waitForSelector(tweetSelector, { timeout: 12000 });
        } catch (e) {
          // If not found quickly, do a short reload and continue the loop
          console.log('⏳ tweet selector not found quickly, trying reload/next attempt...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
          continue;
        }

        // Ensure top-of-page
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(resolve => setTimeout(resolve, 1500));

        // small refresh to fetch newest dynamic content (avoid networkidle0)
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
        await new Promise(resolve => setTimeout(resolve, 1800));

        // Light wiggle scrolls to trigger client fetches for latest
        await page.evaluate(() => {
          window.scrollBy(0, 100);
          window.scrollBy(0, -100);
        });
        await new Promise(resolve => setTimeout(resolve, 1200));

        // Extract the timestamp of the top-most tweet (if available)
        const topInfo = await page.evaluate(() => {
          const first = document.querySelector('article[data-testid="tweet"], article[role="article"]');
          if (!first) return null;
          const timeEl = first.querySelector('time[datetime], time');
          if (!timeEl) {
            // Sometimes relative text exists instead of time element
            const rel = first.querySelector('a time') || first.querySelector('time');
            if (rel) return { iso: rel.getAttribute('datetime') || null, text: rel.innerText || null };
            return null;
          }
          return { iso: timeEl.getAttribute('datetime') || null, text: timeEl.innerText || null };
        });

        if (topInfo && topInfo.iso) {
          topTimestampISO = topInfo.iso;
          const topDate = new Date(topTimestampISO);
          const ageHours = (Date.now() - topDate.getTime()) / (1000 * 60 * 60);
          console.log(`🔎 Top tweet timestamp: ${topTimestampISO} (age: ${ageHours.toFixed(2)} hours)`);

          // If top tweet is within our freshness window, accept
          if (ageHours <= freshWindowHours) {
            navigationSuccess = true;
            console.log('✅ Top tweet is fresh enough, proceeding to extraction');
            break;
          } else {
            console.log('✳️ Top tweet too old; trying another reload/scroll to get newest content');
            // small wait then reload / let client re-render
            await new Promise(resolve => setTimeout(resolve, 1500));
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
          }
        } else {
          // No timestamp found — try a quick scroll to force client to re-fetch latest tweets
          console.log('⚠️ No timestamp on top article; scrolling to trigger re-render');
          await page.evaluate(() => window.scrollBy(0, 400));
          await new Promise(resolve => setTimeout(resolve, 1200));
          await page.evaluate(() => window.scrollTo(0, 0));
          await new Promise(resolve => setTimeout(resolve, 1200));
          continue;
        }

      } catch (navError) {
        console.log(`❌ Navigation/attempt ${attempt} error:`, navError.message);
        // if auth / login errors, break early
        if (navError.message && (navError.message.includes('login') || navError.message.includes('Authentication'))) {
          throw navError;
        }
        // otherwise continue retrying up to maxAttempts
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!navigationSuccess) {
      console.log('⚠️ Could not verify top tweet freshness after attempts — will still extract but results may be stale');
    }

    // Now extract tweets (newer-first)
    console.log('🎯 Extracting tweets now...');
    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article[role="article"]'));

      // Process articles in page order (first = top = newest)
      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];

        try {
          // Skip promoted content
          if (article.querySelector('[data-testid="placementTracking"]') ||
              article.innerText.toLowerCase().includes('promoted') ||
              article.innerText.toLowerCase().includes('ad ')) {
            continue;
          }

          if (i === 0) {
            const articleText = article.innerText.toLowerCase();
            if (articleText.includes('pinned') || articleText.includes('📌')) {
              // If pinned, prefer to skip pinned only if it's explicitly labeled pinned
              // but we don't skip permanently
            }
          }

          // Extract text
          const textSelectors = [
            '[data-testid="tweetText"]',
            'div[lang]',
            'div[dir="auto"]',
            'div[dir="ltr"]',
            'span[dir="ltr"]'
          ];

          let text = '';
          for (const selector of textSelectors) {
            const el = article.querySelector(selector);
            if (el && el.innerText && el.innerText.trim().length > 5) {
              text = el.innerText.trim();
              break;
            }
          }

          if (!text) {
            // fallback to sensible non-meta line
            const fullText = article.innerText || '';
            const lines = fullText.split('\n').map(l => l.trim()).filter(l => l && !/^\d+[smhd]$/.test(l) && !l.includes('Show this thread') && l.length > 5);
            if (lines.length) text = lines[0];
          }

          // If still no content but media exists, keep it as media tweet
          const hasMedia = !!article.querySelector('img[src*="media"], video, [data-testid="videoPlayer"]');
          if (!text && !hasMedia) continue;

          // Link + id
          let link = null;
          let tweetId = null;
          const statusLinks = Array.from(article.querySelectorAll('a[href*="/status/"]'));
          for (const linkEl of statusLinks) {
            const href = linkEl.getAttribute('href');
            if (href && href.includes('/status/')) {
              link = href.startsWith('http') ? href : 'https://x.com' + href;
              const match = href.match(/status\/(\d+)/);
              if (match) { tweetId = match[1]; break; }
            }
          }
          if (!link || !tweetId) continue;

          // timestamp
          let timestamp = null;
          let relativeTime = '';
          const timeElement = article.querySelector('time[datetime], time');
          if (timeElement) {
            timestamp = timeElement.getAttribute('datetime') || null;
            relativeTime = timeElement.innerText || '';
          } else {
            relativeTime = '';
            timestamp = new Date().toISOString();
          }

          // user info
          let username = '';
          let displayName = '';

          // Try to read username from link
          if (link) {
            const parts = link.split('/');
            // link like https://x.com/username/status/id
            if (parts.length >= 4) username = parts[3] || parts[2] || '';
            username = username.replace(/^@/, '');
          }

          const nameSelectors = [
            '[data-testid="User-Name"] span',
            '[data-testid="User-Names"] span',
            'div[dir="ltr"] span'
          ];
          for (const sel of nameSelectors) {
            const el = article.querySelector(sel);
            if (el && el.textContent && el.textContent.trim().length && el.textContent.length < 60) {
              displayName = el.textContent.trim();
              break;
            }
          }
          if (!displayName) displayName = username || 'Unknown User';

          // metrics helper
          const getMetric = (patterns) => {
            for (const pattern of patterns) {
              const elements = article.querySelectorAll(pattern);
              for (const el of elements) {
                const ariaLabel = el.getAttribute('aria-label') || '';
                const textContent = el.textContent || '';
                const combined = (ariaLabel + ' ' + textContent).toLowerCase();
                const m = combined.match(/(\d+(?:[,\s]\d+)*)/);
                if (m) return parseInt(m[1].replace(/[,\s]/g, ''));
              }
            }
            return 0;
          };

          const tweet = {
            id: tweetId,
            username: username || 'unknown',
            displayName,
            text: text || (hasMedia ? '(Media tweet)' : ''),
            link,
            likes: getMetric(['[data-testid="like"]', '[aria-label*="like"]']),
            retweets: getMetric(['[data-testid="retweet"]', '[aria-label*="repost"]']),
            replies: getMetric(['[data-testid="reply"]', '[aria-label*="repl"]']),
            timestamp,
            relativeTime: relativeTime || '',
            scraped_at: new Date().toISOString()
          };

          tweetData.push(tweet);

        } catch (e) {
          // swallow single-article errors
          console.error('Error processing article in page script:', e?.message || e);
        }
      }

      return tweetData;
    }, maxTweets);

    // Ensure newest-first by timestamp if possible
    tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Filter to "fresh" preferentially (last N hours) but fallback to top N tweets
    const now = new Date();
    const freshCutoff = new Date(now.getTime() - freshWindowHours * 60 * 60 * 1000);
    const freshTweets = tweets.filter(t => {
      const dt = new Date(t.timestamp);
      return dt > freshCutoff || t.relativeTime.includes('s') || t.relativeTime.includes('m') || t.relativeTime.includes('h');
    });

    const finalTweets = freshTweets.length >= maxTweets ? freshTweets.slice(0, maxTweets) : tweets.slice(0, maxTweets);
    const totalTime = Date.now() - startTime;
    console.log(`🎉 SUCCESS: Extracted ${finalTweets.length} tweets in ${totalTime}ms`);

    res.json({
      success: true,
      count: finalTweets.length,
      requested: maxTweets,
      tweets: finalTweets,
      scraped_at: new Date().toISOString(),
      profile_url: searchURL,
      performance: {
        total_time_ms: totalTime,
        browser_reused: true
      },
      browser_pool: browserPool.getStats()
    });

  } catch (error) {
    console.error('💥 SCRAPING FAILED:', error.message);

    let suggestion = 'Twitter might be rate limiting or blocking requests. Try again in a few minutes.';

    if (error.message.includes('login') || error.message.includes('Authentication')) {
      suggestion = `Authentication issue. Cookie status: ${browserPool.cookieValidation.message}`;
    } else if (error.message.includes('protected')) {
      suggestion = 'This Twitter account is private/protected. You need to follow the account first.';
    } else if (error.message.includes('suspended')) {
      suggestion = 'The target Twitter account has been suspended.';
    } else if (error.message.includes('rate limit')) {
      suggestion = 'Twitter is rate limiting your requests. Wait 15-30 minutes before trying again.';
    }

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: Date.now() - startTime,
        browser_reused: true
      },
      browser_pool: browserPool.getStats(),
      suggestion
    });
  } finally {
    if (page) {
      await browserPool.releasePage(page);
    }
  }
});

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
