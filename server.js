const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// BROWSER POOL MANAGEMENT
class BrowserPool {
  constructor() {
    this.browser = null;
    this.pages = new Set();
    this.maxPages = 3;
    this.isInitializing = false;
    this.lastHealthCheck = Date.now();
    this.cookiesLoaded = false;
    
    setInterval(() => this.healthCheck(), 5 * 60 * 1000);
  }

  async initialize() {
    if (this.isInitializing) {
      console.log('Browser initialization already in progress...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return this.browser;
    }

    if (this.browser && !this.browser.isConnected()) {
      console.log('Browser disconnected, reinitializing...');
      this.browser = null;
    }

    if (this.browser) {
      console.log('Reusing existing browser instance');
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

      console.log('Launching new browser instance...');
      this.browser = await puppeteer.launch(launchOptions);
      
      this.browser.on('disconnected', () => {
        console.log('Browser disconnected, will reinitialize on next request');
        this.browser = null;
        this.pages.clear();
        this.cookiesLoaded = false;
      });

      console.log('Browser pool initialized successfully');
      this.lastHealthCheck = Date.now();
      
    } catch (error) {
      console.error('Failed to initialize browser:', error.message);
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
      console.log('Max pages reached, waiting for available page...');
      while (this.pages.size >= this.maxPages) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const page = await browser.newPage();
    this.pages.add(page);
    
    // Enhanced page configuration
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);
    
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none'
    });

    // Clear storage and set up page
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        // Hide webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
      } catch (e) {}
    });

    // Load cookies if not already loaded
    if (!this.cookiesLoaded && process.env.TWITTER_COOKIES) {
      await this.loadCookies(page);
    }

    console.log(`Created new page (${this.pages.size}/${this.maxPages} active)`);
    return page;
  }

  async loadCookies(page) {
    try {
      if (!process.env.TWITTER_COOKIES) {
        console.log('No TWITTER_COOKIES environment variable found');
        return false;
      }

      let cookies;
      const cookieStr = process.env.TWITTER_COOKIES.trim();
      
      // Handle different cookie formats
      if (cookieStr.startsWith('[') || cookieStr.startsWith('{')) {
        cookies = JSON.parse(cookieStr);
      } else {
        console.log('TWITTER_COOKIES appears to be in string format, cannot parse');
        return false;
      }
      
      if (!Array.isArray(cookies)) {
        if (typeof cookies === 'object' && cookies.name) {
          cookies = [cookies];
        } else {
          console.log('TWITTER_COOKIES is not an array or valid cookie object');
          return false;
        }
      }
      
      // Filter and validate cookies
      const validCookies = cookies
        .filter(cookie => cookie.name && cookie.value && cookie.domain)
        .map(cookie => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          httpOnly: cookie.httpOnly || false,
          secure: cookie.secure || false,
          sameSite: cookie.sameSite === 'no_restriction' ? 'none' : (cookie.sameSite || 'lax')
        }));
      
      if (validCookies.length > 0) {
        await page.setCookie(...validCookies);
        this.cookiesLoaded = true;
        console.log(`Loaded ${validCookies.length} cookies to browser pool`);
        
        // Log important cookies for debugging
        const importantCookies = validCookies.filter(c => 
          ['auth_token', 'ct0', 'twid'].includes(c.name)
        );
        console.log('Important cookies loaded:', importantCookies.map(c => c.name).join(', '));
        
        return true;
      } else {
        console.log('No valid cookies found after filtering');
        return false;
      }
      
    } catch (err) {
      console.error('Cookie loading failed:', err.message);
      console.log('Raw TWITTER_COOKIES:', process.env.TWITTER_COOKIES?.substring(0, 200) + '...');
    }
    
    return false;
  }

  async releasePage(page) {
    if (!page || !this.pages.has(page)) return;
    
    try {
      await page.close();
    } catch (e) {
      console.error('Error closing page:', e.message);
    }
    
    this.pages.delete(page);
    console.log(`Released page (${this.pages.size}/${this.maxPages} active)`);
  }

  async healthCheck() {
    if (!this.browser) return;
    
    try {
      const version = await this.browser.version();
      console.log(`Health check passed - Browser version: ${version}`);
      this.lastHealthCheck = Date.now();
      
      if (this.pages.size > 1) {
        console.log('Cleaning up idle pages...');
        const pageArray = Array.from(this.pages);
        for (let i = 1; i < pageArray.length; i++) {
          await this.releasePage(pageArray[i]);
        }
      }
      
    } catch (error) {
      console.error('Health check failed:', error.message);
      await this.restart();
    }
  }

  async restart() {
    console.log('Restarting browser pool...');
    
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
    
    await this.initialize();
  }

  getStats() {
    return {
      browser_connected: this.browser?.isConnected() || false,
      active_pages: this.pages.size,
      max_pages: this.maxPages,
      cookies_loaded: this.cookiesLoaded,
      last_health_check: new Date(this.lastHealthCheck).toISOString(),
      uptime_minutes: Math.round((Date.now() - this.lastHealthCheck) / 60000)
    };
  }
}

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
      console.log(`Found Chrome at: ${path}`);
      return path;
    }
  }
  
  console.log('No Chrome executable found, using default');
  return null;
}

app.get('/', (req, res) => {
  const chromePath = findChrome();
  const stats = browserPool.getStats();
  
  res.json({ 
    status: 'Twitter Fresh Tweet Scraper - ENHANCED', 
    chrome: chromePath || 'default',
    browser_pool: stats,
    environment: {
      cookies_configured: !!process.env.TWITTER_COOKIES,
      search_url: process.env.TWITTER_SEARCH_URL || 'Not configured'
    },
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

// DEBUG ENDPOINT - Shows what the page actually contains
app.post('/debug-page', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  let page;
  
  try {
    page = await browserPool.getPage();
    
    console.log('DEBUG: Navigating to:', searchURL);
    const response = await page.goto(searchURL, { 
      waitUntil: 'networkidle0', 
      timeout: 60000 
    });
    
    // Get comprehensive page info
    const pageInfo = await page.evaluate(() => {
      const articles = document.querySelectorAll('article');
      const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
      const tweetTextElements = document.querySelectorAll('[data-testid="tweetText"]');
      
      return {
        url: window.location.href,
        title: document.title,
        articleCount: articles.length,
        tweetElementCount: tweetElements.length,
        tweetTextElementCount: tweetTextElements.length,
        userNameElements: document.querySelectorAll('[data-testid="User-Names"]').length,
        timeElements: document.querySelectorAll('time').length,
        bodyTextSample: document.body.innerText.substring(0, 1000),
        hasLoginForm: !!document.querySelector('input[name="username"]'),
        hasRateLimit: document.body.innerText.includes('rate limit') || document.body.innerText.includes('Rate limit'),
        containsLoggedOut: document.body.innerText.includes('Log in') || document.body.innerText.includes('Sign up'),
        isProtected: document.body.innerText.includes('protected') || document.body.innerText.includes('private'),
        firstArticleHTML: articles.length > 0 ? articles[0].outerHTML.substring(0, 1000) : 'No articles found',
        allTestIds: Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid')).slice(0, 20)
      };
    });
    
    res.json({
      success: true,
      navigation: {
        status: response?.status(),
        url: pageInfo.url,
        title: pageInfo.title
      },
      content_analysis: pageInfo,
      cookies_loaded: browserPool.cookiesLoaded,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  } finally {
    if (page) {
      await browserPool.releasePage(page);
    }
  }
});

// ENHANCED SCRAPE ENDPOINT
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = req.body.maxTweets || 10;
  const debug = req.body.debug || false;
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  let page;
  const startTime = Date.now();
  
  try {
    page = await browserPool.getPage();
    console.log(`Got page from pool in ${Date.now() - startTime}ms`);
    
    console.log('Navigating to:', searchURL);
    
    const response = await page.goto(searchURL, { 
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    console.log('Navigation completed, status:', response?.status());
    
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
      throw new Error('Redirected to login page - Authentication required');
    }

    // Enhanced content detection
    console.log('Waiting for content to load...');
    
    // Try multiple selectors and give detailed feedback
    const selectors = [
      'article[data-testid="tweet"]',
      'article[role="article"]',
      'article',
      '[data-testid="tweet"]',
      '[data-testid="tweetText"]'
    ];
    
    let foundSelector = null;
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        foundSelector = selector;
        console.log(`Found content with selector: ${selector}`);
        break;
      } catch (e) {
        console.log(`Selector ${selector} not found, trying next...`);
      }
    }
    
    if (!foundSelector) {
      // Get detailed page analysis
      const pageAnalysis = await page.evaluate(() => {
        return {
          currentUrl: window.location.href,
          title: document.title,
          bodyText: document.body.innerText.substring(0, 500),
          hasLogin: document.body.innerText.includes('Log in') || document.body.innerText.includes('Sign up'),
          hasRateLimit: document.body.innerText.includes('rate limit'),
          isProtected: document.body.innerText.includes('protected') || document.body.innerText.includes('private'),
          elementCounts: {
            articles: document.querySelectorAll('article').length,
            divs: document.querySelectorAll('div').length,
            spans: document.querySelectorAll('span').length
          }
        };
      });
      
      console.log('Page analysis:', JSON.stringify(pageAnalysis, null, 2));
      
      if (pageAnalysis.hasLogin) {
        throw new Error('Login required - Check your TWITTER_COOKIES environment variable');
      }
      
      if (pageAnalysis.hasRateLimit) {
        throw new Error('Rate limited by Twitter - Try again later');
      }
      
      if (pageAnalysis.isProtected) {
        throw new Error('Account is private/protected - Cannot scrape private accounts');
      }
      
      throw new Error(`No tweet content found. Articles: ${pageAnalysis.elementCounts.articles}`);
    }

    // Wait for content to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Scroll to load content
    console.log('Loading content through scrolling...');
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ENHANCED tweet extraction with better debugging
    console.log('Extracting tweets...');
    const extractionResult = await page.evaluate((maxTweets, debug) => {
      const tweetData = [];
      const debugInfo = {
        totalArticles: 0,
        processedArticles: 0,
        skippedReasons: {},
        extractionErrors: []
      };
      
      const articles = document.querySelectorAll('article');
      debugInfo.totalArticles = articles.length;
      
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

      console.log(`Starting extraction from ${articles.length} articles`);

      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];
        debugInfo.processedArticles++;
        
        try {
          // Skip promoted content
          if (article.querySelector('[data-testid="promotedIndicator"]')) {
            debugInfo.skippedReasons.promoted = (debugInfo.skippedReasons.promoted || 0) + 1;
            continue;
          }

          // Enhanced pinned tweet detection
          const pinnedIndicators = [
            '[aria-label*="Pinned"]',
            '[data-testid="socialContext"]',
            'span:contains("Pinned")',
            '[data-testid="pin"]'
          ];
          
          let isPinned = false;
          for (const indicator of pinnedIndicators) {
            if (article.querySelector(indicator)) {
              isPinned = true;
              break;
            }
          }
          
          // Also check text content for pinned indicators
          if (!isPinned && (article.innerText.includes('Pinned') || article.innerText.includes('📌'))) {
            isPinned = true;
          }

          if (isPinned) {
            debugInfo.skippedReasons.pinned = (debugInfo.skippedReasons.pinned || 0) + 1;
            continue;
          }

          // Get tweet text - try multiple selectors
          const textSelectors = [
            '[data-testid="tweetText"]',
            '.tweet-text',
            'div[lang]'
          ];
          
          let text = '';
          for (const selector of textSelectors) {
            const textElement = article.querySelector(selector);
            if (textElement) {
              text = textElement.innerText.trim();
              break;
            }
          }

          if (!text && !article.querySelector('img')) {
            debugInfo.skippedReasons.noContent = (debugInfo.skippedReasons.noContent || 0) + 1;
            continue;
          }

          // Get tweet link and ID - enhanced detection
          const linkSelectors = [
            'a[href*="/status/"]',
            'time[datetime]',
            'a[href*="/tweet/"]'
          ];
          
          let linkElement = null;
          let href = '';
          
          for (const selector of linkSelectors) {
            linkElement = article.querySelector(selector);
            if (linkElement) {
              href = linkElement.getAttribute('href') || linkElement.closest('a')?.getAttribute('href');
              if (href) break;
            }
          }
          
          if (!href) {
            debugInfo.skippedReasons.noLink = (debugInfo.skippedReasons.noLink || 0) + 1;
            continue;
          }

          const link = href.startsWith('http') ? href : 'https://x.com' + href;
          const tweetId = link.match(/status\/(\d+)/)?.[1];
          
          if (!tweetId) {
            debugInfo.skippedReasons.noTweetId = (debugInfo.skippedReasons.noTweetId || 0) + 1;
            continue;
          }

          // Enhanced timestamp detection
          const timeElement = article.querySelector('time');
          let timestamp = timeElement ? timeElement.getAttribute('datetime') : null;
          const relativeTime = timeElement ? timeElement.innerText.trim() : '';

          if (!timestamp && relativeTime) {
            // Parse relative time
            const timePatterns = [
              { pattern: /(\d+)s/, multiplier: 1000 },
              { pattern: /(\d+)m/, multiplier: 60000 },
              { pattern: /(\d+)h/, multiplier: 3600000 },
              { pattern: /(\d+)d/, multiplier: 86400000 }
            ];
            
            for (const { pattern, multiplier } of timePatterns) {
              const match = relativeTime.match(pattern);
              if (match) {
                const value = parseInt(match[1]);
                timestamp = new Date(now.getTime() - value * multiplier).toISOString();
                break;
              }
            }
            
            if (!timestamp && (relativeTime.includes('now') || relativeTime.includes('seconds'))) {
              timestamp = new Date().toISOString();
            }
          }

          if (!timestamp) {
            debugInfo.skippedReasons.noTimestamp = (debugInfo.skippedReasons.noTimestamp || 0) + 1;
            continue;
          }
          
          const tweetDate = new Date(timestamp);
          if (isNaN(tweetDate.getTime()) || tweetDate < sevenDaysAgo) {
            debugInfo.skippedReasons.tooOld = (debugInfo.skippedReasons.tooOld || 0) + 1;
            continue;
          }

          // Enhanced user detection
          const userSelectors = [
            '[data-testid="User-Names"] a',
            '[data-testid="User-Name"] a',
            'a[href^="/"][href$="' + tweetId + '"]',
            'a[role="link"][href^="/"]'
          ];
          
          let username = '';
          let displayName = '';

          for (const selector of userSelectors) {
            const userElement = article.querySelector(selector);
            if (userElement) {
              const userHref = userElement.getAttribute('href');
              if (userHref && userHref.match(/^\/[^\/]+$/)) {
                username = userHref.replace('/', '');
                break;
              }
            }
          }

          const displayNameElement = article.querySelector('[data-testid="User-Names"] span, [data-testid="User-Name"] span');
          if (displayNameElement) {
            displayName = displayNameElement.textContent.trim();
          }

          // Enhanced metrics extraction
          const getMetric = (testId) => {
            const selectors = [
              `[data-testid="${testId}"]`,
              `[aria-label*="${testId}"]`,
              `button[aria-label*="${testId}"]`,
              `div[aria-label*="${testId}"]`
            ];
            
            for (const selector of selectors) {
              const element = article.querySelector(selector);
              if (element) {
                const text = element.getAttribute('aria-label') || element.textContent || '';
                const match = text.match(/(\d+(?:[,.\s]*\d)*)/);
                if (match) {
                  return parseInt(match[1].replace(/[,.\s]/g, ''));
                }
              }
            }
            return 0;
          };

          const tweetObj = {
            id: tweetId,
            username: username.replace(/^@/, ''),
            displayName: displayName,
            text,
            link,
            likes: getMetric('like'),
            retweets: getMetric('retweet'),
            replies: getMetric('reply'),
            timestamp,
            relativeTime,
            scraped_at: new Date().toISOString()
          };

          tweetData.push(tweetObj);

        } catch (e) {
          debugInfo.extractionErrors.push(`Article ${i}: ${e.message}`);
        }
      }

      return {
        tweets: tweetData,
        debug: debugInfo
      };
    }, maxTweets, debug);

    const tweets = extractionResult.tweets;
    const extractionDebug = extractionResult.debug;

    // Sort by timestamp (newest first)
    tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Less aggressive filtering for recent tweets
    const finalTweets = tweets.slice(0, maxTweets);
    
    const totalTime = Date.now() - startTime;
    console.log(`SUCCESS: Extracted ${finalTweets.length} tweets in ${totalTime}ms`);

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
      browser_pool: browserPool.getStats(),
      extraction_debug: debug ? extractionDebug : undefined
    });

  } catch (error) {
    console.error('SCRAPING FAILED:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: Date.now() - startTime,
        browser_reused: true
      },
      suggestion: error.message.includes('login') || error.message.includes('Authentication') ? 
        'Check your TWITTER_COOKIES environment variable' :
        'Twitter might be blocking requests. Try restarting browser or checking account privacy.'
    });
  } finally {
    if (page) {
      await browserPool.releasePage(page);
    }
  }
});

app.post('/scrape-user', async (req, res) => {
  const username = req.body.username;
  const maxTweets = req.body.maxTweets || 10;
  const debug = req.body.debug || false;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const cleanUsername = username.replace(/^@/, '');
  const profileURL = `https://x.com/${cleanUsername}`;
  
  console.log(`Scraping user: @${cleanUsername}`);
  
  // Forward to main endpoint
  req.body.url = profileURL;
  req.body.debug = debug;
  
  return new Promise((resolve) => {
    const originalJson = res.json;
    const originalStatus = res.status;
    
    res.json = (data) => {
      resolve();
      return originalJson.call(res, data);
    };
    
    res.status = (code) => ({
      json: (data) => {
        resolve();
        return originalStatus.call(res, code).json(data);
      }
    });
    
    app.handle({ ...req, url: '/scrape', method: 'POST' }, res);
  });
});

async function startServer() {
  try {
    console.log('Initializing browser pool...');
    await browserPool.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Twitter Scraper API running on port ${PORT}`);
      console.log(`Chrome executable:`, findChrome() || 'default');
      console.log(`Cookies configured:`, !!process.env.TWITTER_COOKIES);
      console.log(`Default search URL:`, process.env.TWITTER_SEARCH_URL || 'Not configured');
      console.log(`Browser pool ready for 24/7 operation`);
      console.log(`DEBUG: Use POST /debug-page to troubleshoot issues`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

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

startServer();
