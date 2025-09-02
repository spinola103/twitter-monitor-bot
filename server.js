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
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--user-data-dir=/tmp/chrome-pool-data',
          '--lang=en-US'
        ],
        defaultViewport: { width: 1920, height: 1080 }
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
    
    // Enhanced stealth configuration
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);
    
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none'
    });

    // Clear storage and inject anti-detection scripts
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        
        // Remove webdriver traces
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        
        // Mock languages and plugins
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        
      } catch (e) {}
    });

    if (!this.cookiesLoaded && process.env.TWITTER_COOKIES) {
      await this.loadCookies(page);
    }

    console.log(`📄 Created new page (${this.pages.size}/${this.maxPages} active)`);
    return page;
  }

  async loadCookies(page) {
    try {
      if (!process.env.TWITTER_COOKIES) return false;

      let cookies;
      
      if (process.env.TWITTER_COOKIES.trim().startsWith('[') || process.env.TWITTER_COOKIES.trim().startsWith('{')) {
        cookies = JSON.parse(process.env.TWITTER_COOKIES);
      } else {
        console.log('⚠️ TWITTER_COOKIES appears to be in string format');
        return false;
      }
      
      if (!Array.isArray(cookies)) {
        if (typeof cookies === 'object' && cookies.name) {
          cookies = [cookies];
        } else {
          return false;
        }
      }
      
      const validCookies = cookies.filter(cookie => 
        cookie.name && cookie.value && cookie.domain
      );
      
      if (validCookies.length > 0) {
        await page.setCookie(...validCookies);
        this.cookiesLoaded = true;
        console.log(`✅ ${validCookies.length} cookies loaded to browser pool`);
        return true;
      }
      
    } catch (err) {
      console.error('❌ Cookie loading failed:', err.message);
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

// FIXED SCRAPE ENDPOINT WITH UPDATED SELECTORS
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = req.body.maxTweets || 10;
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  let page;
  const startTime = Date.now();
  
  try {
    page = await browserPool.getPage();
    console.log(`⚡ Got page from pool in ${Date.now() - startTime}ms`);
    
    console.log('🌐 Navigating to:', searchURL);
    
    // Navigate with retry logic
    let navSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 Navigation attempt ${attempt}...`);
        const response = await page.goto(searchURL, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        
        console.log(`✅ Navigation completed, status: ${response?.status()}`);
        
        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
          throw new Error('❌ Redirected to login page - Authentication required');
        }
        
        navSuccess = true;
        break;
        
      } catch (navError) {
        console.log(`❌ Navigation attempt ${attempt} failed:`, navError.message);
        if (attempt === 3) throw navError;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!navSuccess) {
      throw new Error('Failed to navigate after 3 attempts');
    }

    // Enhanced content detection with multiple strategies
    console.log('⏳ Waiting for content to load...');
    
    const contentSelectors = [
      '[data-testid="cellInnerDiv"]',
      'article[data-testid="tweet"]',
      'div[data-testid="primaryColumn"]',
      '[data-testid="tweetText"]',
      'main[role="main"]'
    ];
    
    let contentFound = false;
    for (const selector of contentSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        console.log(`✅ Content detected with selector: ${selector}`);
        contentFound = true;
        break;
      } catch (e) {
        console.log(`⏳ Trying next content selector...`);
      }
    }
    
    if (!contentFound) {
      // Check for error conditions
      const pageContent = await page.content();
      const currentUrl = page.url();
      
      if (pageContent.includes('Log in') || 
          pageContent.includes('Sign up') ||
          currentUrl.includes('/login') ||
          pageContent.includes('suspended')) {
        throw new Error(`❌ Authentication required or account suspended`);
      }
      
      if (pageContent.includes('rate limit') || pageContent.includes('Try again')) {
        throw new Error('❌ Rate limited by Twitter - Try again later');
      }
      
      console.log('⚠️ No standard content selectors found, proceeding anyway...');
    }

    // Wait for page to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Progressive loading with smart scrolling
    console.log('🔄 Loading tweets with progressive scrolling...');
    
    // First, scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Progressive scroll to load content
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8);
      });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check if we have enough tweets
      const currentCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-testid="cellInnerDiv"]').length;
      });
      
      console.log(`📊 Current tweet elements found: ${currentCount}`);
      
      if (currentCount >= maxTweets * 2) {
        console.log('✅ Sufficient content loaded, stopping scroll');
        break;
      }
    }
    
    // Return to top for extraction
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // FIXED TWEET EXTRACTION with updated selectors
    console.log('🎯 Extracting tweets with updated selectors...');
    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const now = new Date();
      
      // Updated selectors for current Twitter structure
      const tweetContainers = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      console.log(`Found ${tweetContainers.length} potential tweet containers`);
      
      for (let i = 0; i < tweetContainers.length && tweetData.length < maxTweets; i++) {
        const container = tweetContainers[i];
        
        try {
          // Skip promoted content
          if (container.querySelector('[data-testid="placementTracking"]') ||
              container.querySelector('[aria-label*="Promoted"]') ||
              container.innerText.includes('Promoted') ||
              container.innerText.includes('Ad')) {
            continue;
          }

          // Enhanced pinned tweet detection
          const isPinned = 
            container.querySelector('[data-testid="socialContext"]')?.innerText?.includes('Pinned') ||
            container.querySelector('[aria-label*="Pinned"]') ||
            container.innerText.includes('📌') ||
            (i === 0 && container.querySelector('time') && 
             new Date() - new Date(container.querySelector('time').getAttribute('datetime')) > 24 * 60 * 60 * 1000);

          if (isPinned) {
            console.log('Skipping pinned tweet');
            continue;
          }

          // Look for tweet content within container
          const article = container.querySelector('article') || container;
          
          // Extract tweet text with multiple fallbacks
          let text = '';
          const textSelectors = [
            '[data-testid="tweetText"]',
            '[data-testid="tweet"] div[lang]',
            'div[lang][dir="auto"]',
            '[role="group"] div[lang]'
          ];
          
          for (const selector of textSelectors) {
            const textElement = article.querySelector(selector);
            if (textElement) {
              text = textElement.innerText.trim();
              if (text) break;
            }
          }

          // Skip if no text and no media
          if (!text && !article.querySelector('img[alt*="Image"]') && !article.querySelector('video')) {
            continue;
          }

          // Extract tweet link and ID
          const linkElement = article.querySelector('a[href*="/status/"]') || 
                             container.querySelector('a[href*="/status/"]');
          if (!linkElement) continue;

          const href = linkElement.getAttribute('href');
          const link = href.startsWith('http') ? href : 'https://x.com' + href;
          const tweetId = link.match(/status\/(\d+)/)?.[1];
          if (!tweetId) continue;

          // Extract timestamp with better parsing
          const timeElement = article.querySelector('time') || container.querySelector('time');
          let timestamp = timeElement ? timeElement.getAttribute('datetime') : null;
          const relativeTime = timeElement ? timeElement.innerText.trim() : '';

          // Parse relative time if no datetime
          if (!timestamp && relativeTime) {
            const now = new Date();
            if (relativeTime.includes('s') || relativeTime.toLowerCase().includes('now')) {
              timestamp = new Date().toISOString();
            } else if (relativeTime.includes('m')) {
              const mins = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
              timestamp = new Date(now.getTime() - mins * 60000).toISOString();
            } else if (relativeTime.includes('h')) {
              const hours = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
              timestamp = new Date(now.getTime() - hours * 3600000).toISOString();
            } else if (relativeTime.includes('d')) {
              const days = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
              timestamp = new Date(now.getTime() - days * 86400000).toISOString();
            }
          }

          if (!timestamp) {
            console.log('No valid timestamp found, skipping tweet');
            continue;
          }

          // Extract user information with fallbacks
          let username = '';
          let displayName = '';
          
          const userLinkSelectors = [
            '[data-testid="User-Name"] a[href^="/"]',
            '[data-testid="User-Names"] a[href^="/"]',
            'a[href^="/"][role="link"]'
          ];
          
          for (const selector of userLinkSelectors) {
            const userElement = article.querySelector(selector) || container.querySelector(selector);
            if (userElement) {
              const userHref = userElement.getAttribute('href');
              if (userHref && userHref.includes('/') && !userHref.includes('/status/')) {
                username = userHref.replace('/', '').replace('@', '');
                break;
              }
            }
          }
          
          const displayNameSelectors = [
            '[data-testid="User-Name"] span span',
            '[data-testid="User-Names"] span span',
            '[data-testid="User-Name"] div span'
          ];
          
          for (const selector of displayNameSelectors) {
            const nameElement = article.querySelector(selector) || container.querySelector(selector);
            if (nameElement && nameElement.textContent && !nameElement.textContent.includes('@')) {
              displayName = nameElement.textContent.trim();
              break;
            }
          }

          // Extract engagement metrics with improved selectors
          const getMetric = (testId, container) => {
            const selectors = [
              `[data-testid="${testId}"]`,
              `[aria-label*="${testId}"]`,
              `button[aria-label*="${testId.slice(0, -1)}"]` // reply -> repli
            ];
            
            for (const selector of selectors) {
              const element = container.querySelector(selector);
              if (element) {
                const ariaLabel = element.getAttribute('aria-label') || '';
                const textContent = element.textContent || '';
                const text = ariaLabel || textContent;
                
                const match = text.match(/(\d+(?:[,\.]\d+)*)/);
                if (match) {
                  return parseInt(match[1].replace(/[,\.]/g, ''));
                }
              }
            }
            return 0;
          };

          const tweetObj = {
            id: tweetId,
            username: username,
            displayName: displayName,
            text: text,
            link: link,
            likes: getMetric('like', article) || getMetric('favorite', article),
            retweets: getMetric('retweet', article),
            replies: getMetric('reply', article),
            timestamp: timestamp,
            relativeTime: relativeTime,
            scraped_at: new Date().toISOString(),
            hasMedia: !!(article.querySelector('img[alt*="Image"]') || article.querySelector('video'))
          };

          console.log(`✅ Extracted tweet: @${username} - "${text.substring(0, 50)}..."`);
          tweetData.push(tweetObj);

        } catch (e) {
          console.error(`❌ Error processing container ${i}:`, e.message);
        }
      }

      console.log(`📊 Total tweets extracted: ${tweetData.length}`);
      return tweetData;
    }, maxTweets);

    // Sort by timestamp (newest first) and filter recent tweets only
    const sortedTweets = tweets
      .filter(t => t.timestamp && t.text) // Only tweets with content
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, maxTweets);
    
    const totalTime = Date.now() - startTime;
    console.log(`🎉 SUCCESS: Extracted ${sortedTweets.length} fresh tweets in ${totalTime}ms`);

    res.json({
      success: true,
      count: sortedTweets.length,
      requested: maxTweets,
      tweets: sortedTweets,
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
    
    // Enhanced error diagnosis
    let suggestion = 'Try again in a few minutes.';
    if (error.message.includes('login') || error.message.includes('Authentication')) {
      suggestion = 'Please provide valid Twitter cookies in TWITTER_COOKIES environment variable';
    } else if (error.message.includes('timeout')) {
      suggestion = 'Twitter is loading slowly. Try increasing timeout or checking your internet connection.';
    } else if (error.message.includes('suspended')) {
      suggestion = 'The Twitter account appears to be suspended or private.';
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: Date.now() - startTime,
        browser_reused: true
      },
      suggestion: suggestion
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
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const cleanUsername = username.replace(/^@/, '');
  const profileURL = `https://x.com/${cleanUsername}`;
  
  console.log(`🎯 Scraping user: @${cleanUsername}`);
  
  req.body.url = profileURL;
  
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
    console.log('🔥 Initializing browser pool...');
    await browserPool.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Twitter Scraper API running on port ${PORT}`);
      console.log(`🔍 Chrome executable:`, findChrome() || 'default');
      console.log(`🍪 Cookies configured:`, !!process.env.TWITTER_COOKIES);
      console.log(`🔥 Browser pool ready - FIXED SELECTORS & LOGIC!`);
      console.log(`⚡ Performance: ~10x faster requests with browser reuse`);
    });
  } catch (error) {
    console.error('💥 Failed to start server:', error.message);
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
