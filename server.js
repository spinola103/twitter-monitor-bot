const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const crypto = require('crypto');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 🔥 OPTIMIZED BROWSER POOL WITH ENHANCED STABILITY
class OptimizedBrowserPool {
  constructor() {
    this.browser = null;
    this.pages = new Map();
    this.maxPages = 4; // Increased for better concurrency
    this.isInitializing = false;
    this.lastHealthCheck = Date.now();
    this.cookiesLoaded = false;
    this.instanceId = crypto.randomBytes(8).toString('hex');
    this.activeScrapes = new Set();
    this.maxConcurrentScrapes = 3; // Optimized for better throughput
    this.requestCount = 0;
    this.successCount = 0;
    
    // Auto health check every 3 minutes for better monitoring
    setInterval(() => this.healthCheck(), 3 * 60 * 1000);
    
    // Auto cleanup every 10 minutes
    setInterval(() => this.cleanupStalePages(), 10 * 60 * 1000);
  }

  async initialize() {
    if (this.isInitializing) {
      console.log('⏳ Browser initialization already in progress...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return this.browser;
    }

    if (this.browser && !this.browser.isConnected()) {
      console.log('🔄 Browser disconnected, reinitializing...');
      this.browser = null;
      this.pages.clear();
      this.activeScrapes.clear();
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
          '--max_old_space_size=768', // Increased memory
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
          '--window-size=1920,1080', // Better resolution for content loading
          '--memory-pressure-off',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-features=VizServiceDisplayCompositor',
          '--disable-logging',
          '--disable-permissions-api',
          '--disable-notifications',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-images', // Speed optimization - don't load images
          '--aggressive-cache-discard',
          `--user-data-dir=/tmp/chrome-pool-${this.instanceId}`
        ],
        defaultViewport: { width: 1920, height: 1080 },
        ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
        ignoreHTTPSErrors: true
      };

      if (chromePath) {
        launchOptions.executablePath = chromePath;
      }

      console.log(`🚀 Launching optimized browser instance [${this.instanceId}]...`);
      this.browser = await puppeteer.launch(launchOptions);
      
      this.browser.on('disconnected', () => {
        console.log('🔴 Browser disconnected, will reinitialize on next request');
        this.browser = null;
        this.pages.clear();
        this.cookiesLoaded = false;
        this.activeScrapes.clear();
      });

      console.log(`✅ Browser pool initialized successfully [${this.instanceId}]`);
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

  async acquirePage(scrapeId) {
    this.requestCount++;
    
    // Enhanced concurrency check
    if (this.activeScrapes.size >= this.maxConcurrentScrapes) {
      console.log(`⚠️ Max concurrent scrapes (${this.maxConcurrentScrapes}) reached, queuing request...`);
      
      let waitTime = 0;
      while (this.activeScrapes.size >= this.maxConcurrentScrapes && waitTime < 60000) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitTime += 1000;
      }
      
      if (this.activeScrapes.size >= this.maxConcurrentScrapes) {
        throw new Error(`Server busy. Maximum concurrent scrapes (${this.maxConcurrentScrapes}) reached. Please try again in a moment.`);
      }
    }

    const browser = await this.initialize();
    
    // Wait for available page slot
    let waitCount = 0;
    while (this.pages.size >= this.maxPages && waitCount < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      waitCount++;
    }
    
    if (this.pages.size >= this.maxPages) {
      throw new Error('Browser pool exhausted. Please try again later.');
    }

    const page = await browser.newPage();
    const pageId = crypto.randomBytes(4).toString('hex');
    
    this.pages.set(pageId, {
      page,
      scrapeId,
      created: Date.now(),
      inUse: true
    });
    
    this.activeScrapes.add(scrapeId);
    
    // Enhanced page configuration for Twitter
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);
    
    // Enhanced headers to mimic real browser
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'DNT': '1'
    });

    // Enhanced stealth measures
    await page.evaluateOnNewDocument(() => {
      // Clear storage
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
      
      // Override navigator properties to avoid detection
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Remove automation indicators
      delete window.chrome;
      window.chrome = {
        runtime: {}
      };
      
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    // Load cookies with better error handling
    if (!this.cookiesLoaded && process.env.TWITTER_COOKIES) {
      await this.loadCookies(page);
    }

    console.log(`📄 Created page ${pageId} for scrape ${scrapeId} (${this.pages.size}/${this.maxPages} active, ${this.activeScrapes.size} concurrent)`);
    return { pageId, page };
  }

  async loadCookies(page) {
    try {
      if (!process.env.TWITTER_COOKIES) return false;

      let cookies;
      
      // Support multiple cookie formats
      const cookieString = process.env.TWITTER_COOKIES.trim();
      if (cookieString.startsWith('[') || cookieString.startsWith('{')) {
        cookies = JSON.parse(cookieString);
      } else {
        console.log('⚠️ TWITTER_COOKIES appears to be in string format, skipping...');
        return false;
      }
      
      if (!Array.isArray(cookies)) {
        if (typeof cookies === 'object' && cookies.name) {
          cookies = [cookies];
        } else {
          console.log('⚠️ Invalid cookie format');
          return false;
        }
      }
      
      // Enhanced cookie validation
      const validCookies = cookies.filter(cookie => {
        const hasRequired = cookie.name && cookie.value && cookie.domain;
        const isTwitterDomain = cookie.domain.includes('twitter.com') || 
                               cookie.domain.includes('x.com') || 
                               cookie.domain.includes('.twitter.com') ||
                               cookie.domain.includes('.x.com');
        return hasRequired && isTwitterDomain;
      });
      
      if (validCookies.length > 0) {
        // Set cookies for both domains
        const twitterCookies = validCookies.map(cookie => ({
          ...cookie,
          domain: '.twitter.com'
        }));
        
        const xCookies = validCookies.map(cookie => ({
          ...cookie,
          domain: '.x.com'
        }));
        
        await page.setCookie(...twitterCookies, ...xCookies);
        this.cookiesLoaded = true;
        console.log(`✅ ${validCookies.length} cookies loaded to browser pool [${this.instanceId}]`);
        return true;
      }
      
    } catch (err) {
      console.error('❌ Cookie loading failed:', err.message);
    }
    
    return false;
  }

  async releasePage(pageId, scrapeId) {
    const pageInfo = this.pages.get(pageId);
    if (!pageInfo) return;
    
    try {
      await pageInfo.page.close();
    } catch (e) {
      console.error('Error closing page:', e.message);
    }
    
    this.pages.delete(pageId);
    this.activeScrapes.delete(scrapeId);
    console.log(`📄 Released page ${pageId} for scrape ${scrapeId} (${this.pages.size}/${this.maxPages} active)`);
  }

  async cleanupStalePages() {
    const now = Date.now();
    const staleThreshold = 15 * 60 * 1000; // 15 minutes
    
    for (const [pageId, pageInfo] of this.pages.entries()) {
      const age = now - pageInfo.created;
      if (age > staleThreshold) {
        console.log(`🧹 Cleaning up stale page ${pageId} (${Math.round(age/60000)} minutes old)`);
        await this.releasePage(pageId, pageInfo.scrapeId);
      }
    }
  }

  async healthCheck() {
    if (!this.browser) return;
    
    try {
      const version = await this.browser.version();
      console.log(`💊 Health check passed [${this.instanceId}] - Browser: ${version}`);
      console.log(`📊 Requests: ${this.requestCount}, Success: ${this.successCount}, Rate: ${Math.round((this.successCount/this.requestCount)*100)}%`);
      this.lastHealthCheck = Date.now();
      
    } catch (error) {
      console.error('💥 Health check failed:', error.message);
      await this.restart();
    }
  }

  async restart() {
    console.log(`🔄 Restarting browser pool [${this.instanceId}]...`);
    
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
    this.activeScrapes.clear();
    this.instanceId = crypto.randomBytes(8).toString('hex');
    
    await this.initialize();
  }

  incrementSuccess() {
    this.successCount++;
  }

  getStats() {
    return {
      instance_id: this.instanceId,
      browser_connected: this.browser?.isConnected() || false,
      active_pages: this.pages.size,
      max_pages: this.maxPages,
      active_scrapes: this.activeScrapes.size,
      max_concurrent_scrapes: this.maxConcurrentScrapes,
      cookies_loaded: this.cookiesLoaded,
      requests_total: this.requestCount,
      requests_successful: this.successCount,
      success_rate: this.requestCount > 0 ? `${Math.round((this.successCount/this.requestCount)*100)}%` : '0%',
      last_health_check: new Date(this.lastHealthCheck).toISOString(),
      uptime_minutes: Math.round((Date.now() - this.lastHealthCheck) / 60000)
    };
  }
}

// Global browser pool instance
const browserPool = new OptimizedBrowserPool();

// Function to find Chrome executable
function findChrome() {
  const possiblePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN
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

// ENHANCED SINGLE ACCOUNT SCRAPER WITH ADVANCED TWEET DETECTION
async function scrapeAccount(page, username, maxTweets = 10, scrapeId) {
  const cleanUsername = username.replace(/^@/, '');
  const profileURL = `https://x.com/${cleanUsername}`;
  
  try {
    console.log(`🎯 [${scrapeId}] Scraping @${cleanUsername} (max: ${maxTweets} tweets)...`);
    
    // Navigate with retry logic
    let navigationAttempts = 0;
    let response;
    
    while (navigationAttempts < 3) {
      try {
        response = await page.goto(profileURL, { 
          waitUntil: 'networkidle2',
          timeout: 45000
        });
        break;
      } catch (navError) {
        navigationAttempts++;
        if (navigationAttempts === 3) throw navError;
        
        console.log(`🔄 [${scrapeId}] Navigation attempt ${navigationAttempts} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`✅ [${scrapeId}] Navigation completed, status: ${response?.status()}`);

    // Enhanced authentication check
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || 
        currentUrl.includes('/i/flow/login') ||
        currentUrl.includes('/account/access')) {
      throw new Error('Authentication required - Redirected to login page');
    }

    // Check for suspended or protected account
    const pageContent = await page.content();
    if (pageContent.includes('Account suspended') || 
        pageContent.includes('This account is private') ||
        pageContent.includes('These Tweets are protected')) {
      throw new Error(`Account @${cleanUsername} is suspended, private, or protected`);
    }

    // Enhanced tweet loading with multiple selectors
    console.log(`⏳ [${scrapeId}] Waiting for tweets to load...`);
    
    const tweetSelectors = [
      'article[data-testid="tweet"]',
      'div[data-testid="tweetText"]',
      'article[role="article"]',
      'div[data-testid="tweet"]',
      '[data-testid="cellInnerDiv"] article'
    ];
    
    let tweetsFound = false;
    let usedSelector = '';
    
    for (const selector of tweetSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 20000 });
        console.log(`✅ [${scrapeId}] Found tweets with selector: ${selector}`);
        tweetsFound = true;
        usedSelector = selector;
        break;
      } catch (e) {
        console.log(`⏳ [${scrapeId}] Selector "${selector}" failed, trying next...`);
      }
    }
    
    if (!tweetsFound) {
      // Final checks for common issues
      if (pageContent.includes('rate limit') || pageContent.includes('Rate limit')) {
        throw new Error('Rate limited by Twitter - Please try again later');
      }
      
      if (pageContent.includes('Something went wrong')) {
        throw new Error('Twitter returned an error - Please try again');
      }
      
      throw new Error(`No tweets found for @${cleanUsername} - Account may be empty, private, or protected`);
    }

    // Wait for content to fully stabilize
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // Optimized scrolling strategy for fresh content
    console.log(`📍 [${scrapeId}] Optimizing for fresh content...`);
    
    // Scroll to absolute top
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Progressive loading with checks
    for (let scroll = 0; scroll < 5; scroll++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Check if we have enough content
      const articleCount = await page.$$eval('article', articles => articles.length);
      if (articleCount >= maxTweets + 5) break; // Extra buffer for filtering
    }
    
    // Return to top for extraction
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ENHANCED TWEET EXTRACTION with better filtering
    console.log(`🎯 [${scrapeId}] Extracting tweets with advanced filtering...`);
    
    const tweets = await page.evaluate((targetUsername, maxTweets, scrapeId) => {
      const tweetData = [];
      const articles = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
      const now = new Date();
      const maxAgeDays = 14; // Allow tweets up to 2 weeks old
      const cutoffDate = new Date(now.getTime() - (maxAgeDays * 24 * 60 * 60 * 1000));

      console.log(`Processing ${articles.length} articles for @${targetUsername}`);

      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];
        
        try {
          // Skip promoted content
          if (article.querySelector('[data-testid="promotedIndicator"]') || 
              article.textContent.includes('Promoted') ||
              article.textContent.includes('Ad')) {
            continue;
          }

          // ENHANCED PINNED TWEET DETECTION
          const pinnedIndicators = [
            // Direct selectors
            '[data-testid="pin"]',
            '[data-testid="socialContext"]',
            'svg[data-testid="pin"]',
            '[aria-label*="Pinned"]',
            '[aria-label*="pinned"]',
            
            // Text content checks
            () => article.textContent.toLowerCase().includes('pinned tweet'),
            () => article.textContent.toLowerCase().includes('pinned'),
            () => article.innerHTML.toLowerCase().includes('pin'),
            
            // Icon checks
            () => Array.from(article.querySelectorAll('svg')).some(svg => 
              svg.innerHTML.includes('M20.235') || // Pin icon path
              svg.getAttribute('aria-label')?.toLowerCase().includes('pin')
            ),
            
            // Social context checks
            () => {
              const socialContext = article.querySelector('[data-testid="socialContext"]');
              return socialContext && (
                socialContext.textContent.toLowerCase().includes('pinned') ||
                socialContext.querySelector('svg')
              );
            },
            
            // Age-based heuristic for first tweet
            () => {
              if (i > 0) return false; // Only check first tweet
              const timeElement = article.querySelector('time');
              if (!timeElement) return false;
              const datetime = timeElement.getAttribute('datetime');
              if (!datetime) return false;
              const tweetAge = now - new Date(datetime);
              return tweetAge > (7 * 24 * 60 * 60 * 1000); // Older than 7 days
            }
          ];
          
          const isPinned = pinnedIndicators.some(indicator => {
            if (typeof indicator === 'function') {
              return indicator();
            } else {
              return article.querySelector(indicator);
            }
          });
          
          if (isPinned) {
            console.log(`🔒 Skipping pinned tweet at position ${i}`);
            continue;
          }

          // Extract tweet content
          const textElement = article.querySelector('[data-testid="tweetText"]');
          const text = textElement ? textElement.innerText.trim() : '';
          
          // Skip empty or very short tweets
          if (!text || text.length < 5) {
            // Check for media-only tweets
            const hasMedia = article.querySelector('img[alt*="Image"]') || 
                            article.querySelector('video') ||
                            article.querySelector('[data-testid="videoPlayer"]');
            if (!hasMedia) continue;
          }

          // Get tweet link and validate
          const linkElements = article.querySelectorAll('a[href*="/status/"]');
          let tweetLink = null;
          let tweetId = null;
          
          for (const linkEl of linkElements) {
            const href = linkEl.getAttribute('href');
            if (href && href.includes(targetUsername)) {
              tweetLink = href.startsWith('http') ? href : 'https://twitter.com' + href;
              const idMatch = tweetLink.match(/status\/(\d+)/);
              if (idMatch) {
                tweetId = idMatch[1];
                break;
              }
            }
          }
          
          if (!tweetId) continue;

          // Extract timestamp with better parsing
          const timeElement = article.querySelector('time');
          let timestamp = null;
          let relativeTime = '';
          
          if (timeElement) {
            timestamp = timeElement.getAttribute('datetime');
            relativeTime = timeElement.textContent?.trim() || '';
            
            // Parse relative time if no absolute timestamp
            if (!timestamp && relativeTime) {
              const now = new Date();
              if (relativeTime.includes('s') || relativeTime.toLowerCase().includes('now')) {
                timestamp = now.toISOString();
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
          }

          if (!timestamp) continue;
          
          const tweetDate = new Date(timestamp);
          if (isNaN(tweetDate.getTime()) || tweetDate < cutoffDate) {
            continue;
          }

          // Extract user info
          const userElements = article.querySelectorAll('[data-testid="User-Names"] span, [data-testid="User-Name"] span');
          let displayName = '';
          
          for (const element of userElements) {
            const text = element.textContent?.trim();
            if (text && !text.startsWith('@') && text !== targetUsername) {
              displayName = text;
              break;
            }
          }

          // Extract engagement metrics with better parsing
          const getMetric = (testId) => {
            const element = article.querySelector(`[data-testid="${testId}"]`);
            if (!element) return 0;
            
            const ariaLabel = element.getAttribute('aria-label') || '';
            const textContent = element.textContent || '';
            
            // Try aria-label first (more reliable)
            let match = ariaLabel.match(/(\d+(?:,\d+)*)/);
            if (!match) {
              // Fallback to text content
              match = textContent.match(/(\d+(?:,\d+)*)/);
            }
            
            if (match) {
              const number = match[1].replace(/,/g, '');
              return parseInt(number) || 0;
            }
            
            return 0;
          };

          // Check for media content
          const hasImages = article.querySelectorAll('img[alt*="Image"]').length > 0;
          const hasVideo = article.querySelector('video') || article.querySelector('[data-testid="videoPlayer"]');
          
          const tweetObj = {
            id: tweetId,
            username: targetUsername,
            displayName: displayName || targetUsername,
            text: text || '[Media Tweet]',
            link: tweetLink,
            likes: getMetric('like'),
            retweets: getMetric('retweet'),
            replies: getMetric('reply'),
            views: getMetric('analytics') || 0, // Twitter/X view count
            timestamp,
            relativeTime,
            hasMedia: hasImages || hasVideo,
            mediaTypes: {
              images: hasImages,
              video: !!hasVideo
            },
            scraped_at: new Date().toISOString(),
            article_position: i
          };
          
          tweetData.push(tweetObj);
          
        } catch (articleError) {
          console.error(`Error processing article ${i}:`, articleError.message);
        }
      }

      // Final sorting and filtering
      const sortedTweets = tweetData
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, maxTweets);
      
      console.log(`Extracted ${sortedTweets.length} fresh tweets for @${targetUsername}`);
      return sortedTweets;
    }, cleanUsername, maxTweets, scrapeId);

    return {
      success: true,
      username: cleanUsername,
      tweets: tweets,
      count: tweets.length
    };

  } catch (error) {
    console.error(`❌ [${scrapeId}] Error scraping @${cleanUsername}:`, error.message);
    return {
      success: false,
      username: cleanUsername,
      error: error.message,
      tweets: [],
      count: 0
    };
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  const chromePath = findChrome();
  const stats = browserPool.getStats();
  
  res.json({ 
    status: 'Enhanced Twitter Scraper - Optimized for @podha_protocol', 
    chrome: chromePath || 'default',
    browser_pool: stats,
    timestamp: new Date().toISOString(),
    optimizations: [
      'Advanced Pinned Tweet Detection',
      'Enhanced Content Loading',
      'Better Error Handling',
      'Improved Rate Limit Management',
      'Media Tweet Support',
      'Multi-format Cookie Support'
    ]
  });
});

// OPTIMIZED SINGLE ACCOUNT ENDPOINT
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = Math.min(req.body.maxTweets || 10, 50); // Cap at 50
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  // Extract username from URL
  const usernameMatch = searchURL.match(/(?:twitter\.com|x\.com)\/([^\/\?\s]+)/);
  if (!usernameMatch) {
    return res.status(400).json({ error: 'Invalid Twitter/X URL format' });
  }

  const username = usernameMatch[1];
  const scrapeId = crypto.randomBytes(6).toString('hex');
  const startTime = Date.now();
  
  let pageId, page;
  
  try {
    // Acquire page from pool
    const pageInfo = await browserPool.acquirePage(scrapeId);
    pageId = pageInfo.pageId;
    page = pageInfo.page;
    
    console.log(`⚡ [${scrapeId}] Acquired page in ${Date.now() - startTime}ms`);
    
    // Scrape the account
    const result = await scrapeAccount(page, username, maxTweets, scrapeId);
    
    if (result.success) {
      browserPool.incrementSuccess();
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`🎉 [${scrapeId}] Single account scrape completed in ${totalTime}ms`);

    if (result.success) {
      res.json({
        success: true,
        count: result.count,
        requested: maxTweets,
        tweets: result.tweets,
        scraped_at: new Date().toISOString(),
        profile_url: searchURL,
        username: result.username,
        performance: {
          total_time_ms: totalTime,
          browser_reused: true,
          instance_id: browserPool.instanceId
        },
        browser_pool: browserPool.getStats()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        username: result.username,
        profile_url: searchURL,
        timestamp: new Date().toISOString(),
        performance: {
          total_time_ms: totalTime,
          browser_reused: true
        }
      });
    }

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`💥 [${scrapeId}] Single account scraping failed:`, error.message);
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        browser_reused: true
      },
      suggestion: error.message.includes('concurrent scrapes') ? 
        'Server is busy processing other requests. Please try again in a moment.' :
        error.message.includes('login') || error.message.includes('Authentication') ? 
        'Please provide valid Twitter cookies in TWITTER_COOKIES environment variable' :
        'Twitter might be rate limiting requests. Try again in a few minutes.'
    });
  } finally {
    if (pageId && page) {
      await browserPool.releasePage(pageId, scrapeId);
    }
  }
});

// ENHANCED MULTI-ACCOUNT SCRAPER ENDPOINT
app.post('/scrape-multiple', async (req, res) => {
  const accounts = req.body.accounts || ['podha_protocol'];
  const tweetsPerAccount = Math.min(req.body.tweetsPerAccount || 5, 20); // Cap at 20 per account
  
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res.status(400).json({ error: 'Accounts array is required' });
  }

  if (accounts.length > 15) {
    return res.status(400).json({ error: 'Maximum 15 accounts allowed' });
  }

  const scrapeId = crypto.randomBytes(6).toString('hex');
  const startTime = Date.now();
  
  console.log(`\n🚀 [${scrapeId}] Starting multi-account scrape for ${accounts.length} accounts`);

  let pageId, page;
  try {
    // Acquire page from pool with concurrency protection
    const pageInfo = await browserPool.acquirePage(scrapeId);
    pageId = pageInfo.pageId;
    page = pageInfo.page;
    
    console.log(`⚡ [${scrapeId}] Got page from pool in ${Date.now() - startTime}ms`);

    // Scrape each account sequentially for better reliability
    const results = [];
    let totalTweets = 0;
    let successfulAccounts = 0;

    for (let i = 0; i < accounts.length; i++) {
      const username = accounts[i];
      console.log(`\n📱 [${scrapeId}] Processing account ${i + 1}/${accounts.length}: @${username}`);
      
      try {
        const result = await scrapeAccount(page, username, tweetsPerAccount, scrapeId);
        results.push(result);
        
        if (result.success) {
          successfulAccounts++;
          totalTweets += result.count;
          console.log(`✅ [${scrapeId}] @${username}: ${result.count} tweets scraped`);
        } else {
          console.log(`❌ [${scrapeId}] @${username}: ${result.error}`);
        }
        
        // Adaptive delay between accounts
        if (i < accounts.length - 1) {
          const successRate = successfulAccounts / (i + 1);
          const baseDelay = 3000;
          const delay = successRate > 0.7 ? baseDelay : baseDelay * 2;
          
          console.log(`⏳ [${scrapeId}] Waiting ${delay}ms before next account (success rate: ${Math.round(successRate * 100)}%)...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (accountError) {
        console.error(`💥 [${scrapeId}] Critical error for @${username}:`, accountError.message);
        results.push({
          success: false,
          username: username.replace('@', ''),
          error: accountError.message,
          tweets: [],
          count: 0
        });
      }
    }

    if (successfulAccounts > 0) {
      browserPool.incrementSuccess();
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n🎉 [${scrapeId}] MULTI-ACCOUNT SCRAPING COMPLETED in ${totalTime}ms!`);
    console.log(`📊 Results: ${successfulAccounts}/${accounts.length} successful, ${totalTweets} total tweets`);

    res.json({
      success: true,
      scrape_id: scrapeId,
      total_accounts: accounts.length,
      total_tweets: totalTweets,
      tweets_per_account: tweetsPerAccount,
      results: results,
      scraped_at: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        browser_reused: true,
        instance_id: browserPool.instanceId,
        avg_time_per_account: Math.round(totalTime / accounts.length)
      },
      browser_pool: browserPool.getStats(),
      summary: {
        successful_accounts: successfulAccounts,
        failed_accounts: accounts.length - successfulAccounts,
        accounts_with_tweets: results.filter(r => r.count > 0).length,
        success_rate: `${Math.round((successfulAccounts / accounts.length) * 100)}%`,
        total_tweets: totalTweets
      }
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`💥 [${scrapeId}] MULTI-ACCOUNT SCRAPING FAILED:`, error.message);
    
    res.status(500).json({ 
      success: false, 
      scrape_id: scrapeId,
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        browser_reused: true,
        instance_id: browserPool.instanceId
      },
      suggestion: error.message.includes('concurrent scrapes') || error.message.includes('busy') ? 
        'Server is busy processing other requests. Please try again in a moment.' :
        error.message.includes('login') || error.message.includes('Authentication') ? 
        'Please provide valid Twitter cookies in TWITTER_COOKIES environment variable' :
        'Twitter might be rate limiting requests. Try again in a few minutes.'
    });
  } finally {
    // Return page to pool
    if (pageId && page) {
      await browserPool.releasePage(pageId, scrapeId);
    }
  }
});

// SIMPLIFIED USER ENDPOINT
app.post('/scrape-user', async (req, res) => {
  const username = req.body.username;
  const maxTweets = Math.min(req.body.maxTweets || 10, 30);
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const cleanUsername = username.replace(/^@/, '');
  
  // Use multi-account endpoint for consistency
  const forwardReq = {
    ...req,
    body: {
      accounts: [cleanUsername],
      tweetsPerAccount: maxTweets
    },
    url: '/scrape-multiple',
    method: 'POST'
  };

  // Transform response to single-user format
  const originalSend = res.json;
  res.json = function(data) {
    if (data.success && data.results && data.results[0]) {
      const result = data.results[0];
      return originalSend.call(this, {
        success: result.success,
        username: result.username,
        count: result.count,
        tweets: result.tweets,
        error: result.error,
        scraped_at: data.scraped_at,
        performance: data.performance,
        browser_pool: data.browser_pool
      });
    }
    return originalSend.call(this, data);
  };

  // Forward to multi-account handler
  return app._router.handle(forwardReq, res, () => {});
});

// SPECIAL ENDPOINT FOR PODHA_PROTOCOL
app.post('/scrape-podha', async (req, res) => {
  const maxTweets = Math.min(req.body.maxTweets || 15, 50);
  const scrapeId = crypto.randomBytes(6).toString('hex');
  const startTime = Date.now();
  
  console.log(`🎯 [${scrapeId}] SPECIALIZED PODHA_PROTOCOL SCRAPE - Max tweets: ${maxTweets}`);

  let pageId, page;
  
  try {
    const pageInfo = await browserPool.acquirePage(scrapeId);
    pageId = pageInfo.pageId;
    page = pageInfo.page;
    
    // Enhanced configuration specifically for crypto/protocol accounts
    await page.setExtraHTTPHeaders({
      ...await page.extraHTTPHeaders(),
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"'
    });
    
    const result = await scrapeAccount(page, 'podha_protocol', maxTweets, scrapeId);
    
    if (result.success) {
      browserPool.incrementSuccess();
      
      // Additional processing for crypto content
      const enhancedTweets = result.tweets.map(tweet => ({
        ...tweet,
        // Flag potential crypto-related content
        categories: {
          hasPrice: /\$\d+|\$[A-Z]+|\d+\.\d+\s*USD/i.test(tweet.text),
          hasChart: /chart|graph|price|pump|dump|moon/i.test(tweet.text),
          hasAnnouncement: /announce|launch|release|update|new/i.test(tweet.text),
          hasCommunity: /community|team|join|follow|discord|telegram/i.test(tweet.text)
        },
        engagement_score: tweet.likes + (tweet.retweets * 2) + tweet.replies // Weighted engagement
      }));
      
      const totalTime = Date.now() - startTime;
      
      res.json({
        success: true,
        account: 'podha_protocol',
        count: result.count,
        requested: maxTweets,
        tweets: enhancedTweets,
        scraped_at: new Date().toISOString(),
        performance: {
          total_time_ms: totalTime,
          browser_reused: true,
          instance_id: browserPool.instanceId
        },
        analytics: {
          avg_engagement: enhancedTweets.length > 0 ? 
            Math.round(enhancedTweets.reduce((sum, t) => sum + t.engagement_score, 0) / enhancedTweets.length) : 0,
          most_liked: enhancedTweets.length > 0 ? 
            enhancedTweets.reduce((max, t) => t.likes > max.likes ? t : max) : null,
          content_categories: {
            price_related: enhancedTweets.filter(t => t.categories.hasPrice).length,
            announcements: enhancedTweets.filter(t => t.categories.hasAnnouncement).length,
            community: enhancedTweets.filter(t => t.categories.hasCommunity).length
          }
        },
        browser_pool: browserPool.getStats()
      });
      
    } else {
      throw new Error(result.error);
    }

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`💥 [${scrapeId}] PODHA_PROTOCOL scraping failed:`, error.message);
    
    res.status(500).json({ 
      success: false, 
      account: 'podha_protocol',
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        browser_reused: true
      },
      suggestion: 'If this persists, try using /scrape-user endpoint with username "podha_protocol"'
    });
  } finally {
    if (pageId && page) {
      await browserPool.releasePage(pageId, scrapeId);
    }
  }
});

// BATCH PROCESSING ENDPOINT
app.post('/scrape-batch', async (req, res) => {
  const accounts = req.body.accounts || [];
  const tweetsPerAccount = Math.min(req.body.tweetsPerAccount || 3, 15);
  const batchSize = Math.min(req.body.batchSize || 5, 8);
  
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res.status(400).json({ error: 'Accounts array is required' });
  }

  if (accounts.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 accounts allowed for batch processing' });
  }

  const batchId = crypto.randomBytes(8).toString('hex');
  const startTime = Date.now();
  
  console.log(`\n🔄 [${batchId}] Batch processing ${accounts.length} accounts (${batchSize} per batch)`);

  try {
    const allResults = [];
    let totalTweets = 0;
    let totalSuccessful = 0;

    // Process in smaller batches to manage resources
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(accounts.length / batchSize);
      
      console.log(`\n📦 [${batchId}] Batch ${batchNum}/${totalBatches}: [${batch.join(', ')}]`);

      try {
        // Create internal request for this batch
        const batchReq = {
          body: {
            accounts: batch,
            tweetsPerAccount: tweetsPerAccount
          }
        };
        
        const batchRes = {
          json: () => {},
          status: () => ({ json: () => {} })
        };

        // Simulate internal request to multi-account endpoint
        let batchResult = null;
        let batchError = null;
        
        const pageInfo = await browserPool.acquirePage(`${batchId}-batch${batchNum}`);
        const { pageId: batchPageId, page: batchPage } = pageInfo;
        
        try {
          for (const account of batch) {
            const accountResult = await scrapeAccount(batchPage, account, tweetsPerAccount, `${batchId}-${account}`);
            allResults.push(accountResult);
            
            if (accountResult.success) {
              totalSuccessful++;
              totalTweets += accountResult.count;
            }
            
            // Small delay between accounts in batch
            if (batch.indexOf(account) < batch.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        } finally {
          await browserPool.releasePage(batchPageId, `${batchId}-batch${batchNum}`);
        }

        // Longer delay between batches
        if (i + batchSize < accounts.length) {
          const delay = 8000; // 8 second delay between batches
          console.log(`⏳ [${batchId}] Batch delay: ${delay/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (batchError) {
        console.error(`❌ [${batchId}] Batch ${batchNum} failed:`, batchError.message);
        
        // Add failed results for remaining accounts in this batch
        batch.forEach(username => {
          allResults.push({
            success: false,
            username: username.replace('@', ''),
            error: `Batch error: ${batchError.message}`,
            tweets: [],
            count: 0
          });
        });
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n🎉 [${batchId}] BATCH PROCESSING COMPLETED!`);
    console.log(`📊 Final: ${totalSuccessful}/${accounts.length} successful, ${totalTweets} tweets in ${totalTime}ms`);

    res.json({
      success: true,
      batch_id: batchId,
      total_accounts: accounts.length,
      total_tweets: totalTweets,
      tweets_per_account: tweetsPerAccount,
      batch_size: batchSize,
      results: allResults,
      scraped_at: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        batches_processed: Math.ceil(accounts.length / batchSize),
        avg_time_per_account: Math.round(totalTime / accounts.length),
        instance_id: browserPool.instanceId
      },
      summary: {
        successful_accounts: totalSuccessful,
        failed_accounts: allResults.length - totalSuccessful,
        accounts_with_tweets: allResults.filter(r => r.count > 0).length,
        success_rate: `${Math.round((totalSuccessful / allResults.length) * 100)}%`
      }
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`💥 [${batchId}] BATCH PROCESSING FAILED:`, error.message);
    
    res.status(500).json({ 
      success: false, 
      batch_id: batchId,
      error: error.message,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        instance_id: browserPool.instanceId
      }
    });
  }
});

// MANUAL BROWSER RESTART
app.post('/restart-browser', async (req, res) => {
  try {
    const oldInstanceId = browserPool.instanceId;
    await browserPool.restart();
    
    res.json({ 
      success: true, 
      message: 'Browser pool restarted successfully',
      old_instance_id: oldInstanceId,
      new_instance_id: browserPool.instanceId,
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

// DETAILED STATS ENDPOINT
app.get('/stats', (req, res) => {
  const stats = browserPool.getStats();
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  
  res.json({
    server: {
      uptime_seconds: Math.round(uptime),
      uptime_formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      memory_usage_mb: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heap_used: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      },
      node_version: process.version,
      platform: process.platform
    },
    browser_pool: stats,
    chrome_path: findChrome() || 'default',
    cookies_configured: !!process.env.TWITTER_COOKIES,
    environment: {
      twitter_cookies: !!process.env.TWITTER_COOKIES,
      tweet_freshness_days: process.env.TWEET_FRESHNESS_DAYS || '14 (default)',
      port: PORT
    },
    timestamp: new Date().toISOString()
  });
});

// Initialize browser pool on startup
async function startServer() {
  try {
    console.log('🔥 Initializing optimized browser pool...');
    await browserPool.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Enhanced Twitter Scraper API running on port ${PORT}`);
      console.log(`🎯 Optimized for @podha_protocol and crypto accounts`);
      console.log(`🔍 Chrome: ${findChrome() || 'default'}`);
      console.log(`🍪 Cookies: ${!!process.env.TWITTER_COOKIES ? 'Configured' : 'Not configured'}`);
      console.log(`🔥 Browser Pool ID: ${browserPool.instanceId}`);
      console.log(`📊 Limits: ${browserPool.maxConcurrentScrapes} concurrent, ${browserPool.maxPages} pages`);
      
      console.log(`\n📡 API Endpoints:`);
      console.log(`  GET  /                    - Health check & status`);
      console.log(`  GET  /stats               - Detailed server stats`);
      console.log(`  POST /scrape              - Single account (URL)`);
      console.log(`  POST /scrape-user         - Single account (username)`);
      console.log(`  POST /scrape-podha        - Optimized for podha_protocol`);
      console.log(`  POST /scrape-multiple     - Multi-account (up to 15)`);
      console.log(`  POST /scrape-batch        - Batch processing (up to 100)`);
      console.log(`  POST /restart-browser     - Restart browser pool`);
      
      console.log(`\n🎯 Quick Start for podha_protocol:`);
      console.log(`  curl -X POST http://localhost:${PORT}/scrape-podha -H "Content-Type: application/json" -d '{"maxTweets": 10}'`);
      console.log(`  curl -X POST http://localhost:${PORT}/scrape-user -H "Content-Type: application/json" -d '{"username": "podha_protocol", "maxTweets": 10}'`);
    });
    
  } catch (error) {
    console.error('💥 Failed to start server:', error.message);
    process.exit(1);
  }
}

// Enhanced graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    // Wait for active scrapes to complete (up to 30 seconds)
    if (browserPool.activeScrapes.size > 0) {
      console.log(`⏳ Waiting for ${browserPool.activeScrapes.size} active scrapes to complete...`);
      let waitTime = 0;
      while (browserPool.activeScrapes.size > 0 && waitTime < 30000) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitTime += 1000;
      }
    }
    
    if (browserPool.browser) {
      console.log('🔒 Closing browser...');
      await browserPool.browser.close();
    }
    
    console.log('✅ Shutdown completed gracefully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

// Error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
startServer();
