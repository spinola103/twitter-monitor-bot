const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const crypto = require('crypto');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Enhanced Browser Manager for Single Account Scraping
class TwitterScraperBrowser {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isInitializing = false;
    this.cookiesLoaded = false;
    this.instanceId = crypto.randomBytes(8).toString('hex');
    this.lastHealthCheck = Date.now();
    
    // Auto health check every 10 minutes
    setInterval(() => this.healthCheck(), 10 * 60 * 1000);
  }

  async initialize() {
    if (this.isInitializing) {
      console.log('⏳ Browser initialization in progress...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return this.browser;
    }

    if (this.browser && !this.browser.isConnected()) {
      console.log('🔄 Browser disconnected, reinitializing...');
      this.browser = null;
      this.page = null;
    }

    if (this.browser) {
      console.log('✅ Reusing existing browser');
      return this.browser;
    }

    this.isInitializing = true;
    
    try {
      const chromePath = this.findChrome();
      
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
          '--disable-features=TranslateUI,VizDisplayCompositor',
          '--disable-ipc-flooding-protection',
          '--window-size=1920,1080',
          '--memory-pressure-off',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          `--user-data-dir=/tmp/twitter-scraper-${this.instanceId}`,
          // Additional stealth args
          '--disable-extensions',
          '--disable-plugins-discovery',
          '--disable-preconnect',
          '--disable-default-apps'
        ],
        defaultViewport: { width: 1920, height: 1080 }
      };

      if (chromePath) {
        launchOptions.executablePath = chromePath;
      }

      console.log(`🚀 Launching browser [${this.instanceId}]...`);
      this.browser = await puppeteer.launch(launchOptions);
      
      this.browser.on('disconnected', () => {
        console.log('🔴 Browser disconnected');
        this.browser = null;
        this.page = null;
        this.cookiesLoaded = false;
      });

      console.log(`✅ Browser initialized successfully [${this.instanceId}]`);
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
    
    if (this.page && !this.page.isClosed()) {
      console.log('♻️ Reusing existing page');
      return this.page;
    }

    console.log('📄 Creating new page...');
    this.page = await browser.newPage();
    
    // Enhanced stealth configuration
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await this.page.setCacheEnabled(false);
    
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    });

    // Remove webdriver traces
    await this.page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      
      // Clear storage
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
    });

    // Load cookies if available
    if (!this.cookiesLoaded && process.env.TWITTER_COOKIES) {
      await this.loadCookies();
    }

    return this.page;
  }

  async loadCookies() {
    if (!process.env.TWITTER_COOKIES || !this.page) return false;

    try {
      let cookies;
      
      if (process.env.TWITTER_COOKIES.trim().startsWith('[') || 
          process.env.TWITTER_COOKIES.trim().startsWith('{')) {
        cookies = JSON.parse(process.env.TWITTER_COOKIES);
      } else {
        console.log('⚠️ TWITTER_COOKIES should be in JSON format');
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
        await this.page.setCookie(...validCookies);
        this.cookiesLoaded = true;
        console.log(`✅ Loaded ${validCookies.length} cookies`);
        return true;
      }
      
    } catch (err) {
      console.error('❌ Cookie loading failed:', err.message);
    }
    
    return false;
  }

  findChrome() {
    const possiblePaths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      process.env.PUPPETEER_EXECUTABLE_PATH
    ].filter(Boolean);

    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        console.log(`✅ Found Chrome at: ${path}`);
        return path;
      }
    }
    
    console.log('⚠️ Using default Chrome path');
    return null;
  }

  async healthCheck() {
    if (!this.browser) return;
    
    try {
      const version = await this.browser.version();
      console.log(`💊 Health check OK [${this.instanceId}] - ${version}`);
      this.lastHealthCheck = Date.now();
    } catch (error) {
      console.error('💥 Health check failed:', error.message);
      await this.restart();
    }
  }

  async restart() {
    console.log(`🔄 Restarting browser [${this.instanceId}]...`);
    
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
    } catch (e) {
      console.error('Error during restart:', e.message);
    }
    
    this.browser = null;
    this.page = null;
    this.cookiesLoaded = false;
    this.instanceId = crypto.randomBytes(8).toString('hex');
    
    await this.initialize();
  }

  getStats() {
    return {
      instance_id: this.instanceId,
      browser_connected: this.browser?.isConnected() || false,
      page_active: this.page && !this.page.isClosed(),
      cookies_loaded: this.cookiesLoaded,
      last_health_check: new Date(this.lastHealthCheck).toISOString()
    };
  }

  async close() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
    } catch (error) {
      console.error('Error closing browser:', error.message);
    }
    
    this.browser = null;
    this.page = null;
  }
}

// Global browser instance
const twitterBrowser = new TwitterScraperBrowser();

// Enhanced account validation and error detection
async function validateAccountAccess(page, username) {
  const currentUrl = page.url();
  const pageContent = await page.content();
  
  // Check for authentication issues
  if (currentUrl.includes('/login') || 
      currentUrl.includes('/i/flow/login') ||
      currentUrl.includes('/i/flow/signup')) {
    return { valid: false, error: 'Authentication required - redirected to login', code: 'AUTH_REQUIRED' };
  }

  // Check for rate limiting (most specific patterns first)
  const rateLimitPatterns = [
    /rate limit exceeded/i,
    /rate limited/i,
    /too many requests/i,
    /temporarily restricted/i,
    /try again later/i
  ];
  
  for (const pattern of rateLimitPatterns) {
    if (pattern.test(pageContent)) {
      return { valid: false, error: 'Rate limited by Twitter', code: 'RATE_LIMITED' };
    }
  }
  
  // Check for suspended account (be very specific)
  const suspendedPatterns = [
    /account suspended/i,
    /this account has been suspended/i,
    /suspended.*violat/i // "suspended for violating"
  ];
  
  // Only flag as suspended if we're on the correct profile AND see suspension message
  const isOnCorrectProfile = currentUrl.includes(`/${username}`) || currentUrl.includes(`/${username.toLowerCase()}`);
  
  if (isOnCorrectProfile) {
    for (const pattern of suspendedPatterns) {
      if (pattern.test(pageContent)) {
        return { valid: false, error: `Account @${username} is suspended`, code: 'SUSPENDED' };
      }
    }
  }
  
  // Check for non-existent account (only if we're sure we're on the right page)
  const notFoundPatterns = [
    /this account doesn't exist/i,
    /sorry, that page doesn't exist/i,
    /page not found/i
  ];
  
  if (isOnCorrectProfile || currentUrl.includes('/status/404')) {
    for (const pattern of notFoundPatterns) {
      if (pattern.test(pageContent)) {
        return { valid: false, error: `Account @${username} doesn't exist`, code: 'NOT_FOUND' };
      }
    }
  }
  
  // Check for protected account
  const protectedPatterns = [
    /tweets are protected/i,
    /this account's tweets are protected/i,
    /these tweets are protected/i
  ];
  
  for (const pattern of protectedPatterns) {
    if (pattern.test(pageContent)) {
      return { valid: false, error: `Account @${username} is private/protected`, code: 'PROTECTED' };
    }
  }
  
  // Check if we successfully loaded the profile
  const profileIndicators = [
    `data-testid="UserName"`,
    `data-testid="UserDescription"`,
    `data-testid="tweet"`,
    username.toLowerCase(),
    `@${username.toLowerCase()}`
  ];
  
  const hasProfileIndicators = profileIndicators.some(indicator => 
    pageContent.toLowerCase().includes(indicator.toLowerCase())
  );
  
  if (!hasProfileIndicators && isOnCorrectProfile) {
    return { valid: false, error: `Unable to load profile for @${username} - may require authentication`, code: 'PROFILE_LOAD_FAILED' };
  }
  
  return { valid: true, code: 'SUCCESS' };
}

// Enhanced tweet extraction with better selectors and validation
async function extractTweets(page, username, maxTweets = 10) {
  console.log(`🎯 Extracting up to ${maxTweets} tweets...`);
  
  return await page.evaluate((username, maxTweets) => {
    const tweets = [];
    const now = new Date();
    
    // More comprehensive article selection
    const articleSelectors = [
      'article[data-testid="tweet"]',
      'article[role="article"]',
      'div[data-testid="tweet"]',
      'article'
    ];
    
    let articles = [];
    for (const selector of articleSelectors) {
      articles = document.querySelectorAll(selector);
      if (articles.length > 0) break;
    }
    
    console.log(`Found ${articles.length} potential tweet articles`);
    
    for (let i = 0; i < articles.length && tweets.length < maxTweets; i++) {
      const article = articles[i];
      
      try {
        // Skip promoted tweets
        if (article.querySelector('[data-testid="promotedIndicator"]') ||
            article.querySelector('[aria-label*="Promoted"]') ||
            article.textContent.includes('Promoted')) {
          continue;
        }
        
        // More sophisticated pinned tweet detection
        const pinnedIndicators = [
          '[data-testid="pin"]',
          'svg[data-testid="pin"]',
          '[aria-label*="Pinned"]',
          '[data-testid="socialContext"]'
        ];
        
        const isPinned = pinnedIndicators.some(selector => {
          const element = article.querySelector(selector);
          if (!element) return false;
          
          // Check if the element or its text content indicates pinned
          const textContent = element.textContent?.toLowerCase() || '';
          const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
          
          return textContent.includes('pinned') || ariaLabel.includes('pinned');
        });
        
        // For first few tweets, be more lenient with pinned detection
        if (isPinned && i < 3) {
          console.log(`Skipping pinned tweet at position ${i}`);
          continue;
        }
        
        // Extract tweet text with multiple fallback selectors
        const textSelectors = [
          '[data-testid="tweetText"]',
          '.tweet-text',
          '[lang]:not([data-testid="UserName"]):not([data-testid="Time"])',
          'div[dir="auto"]:not([data-testid="UserName"]):not([data-testid="Time"])'
        ];
        
        let tweetText = '';
        for (const selector of textSelectors) {
          const textElement = article.querySelector(selector);
          if (textElement && textElement.innerText?.trim()) {
            // Avoid user names and other metadata
            const text = textElement.innerText.trim();
            if (text.length > 10 && !text.startsWith('@') && !text.match(/^\d+[hm]$/)) {
              tweetText = text;
              break;
            }
          }
        }
        
        // Skip if no meaningful text and no media
        if (!tweetText && !article.querySelector('img[alt*="Image"]')) {
          continue;
        }
        
        if (tweetText.length < 3) continue;
        
        // Extract tweet link and ID
        const linkElement = article.querySelector('a[href*="/status/"]') || 
                           article.querySelector('time')?.closest('a');
        if (!linkElement) continue;
        
        const href = linkElement.getAttribute('href');
        const link = href.startsWith('http') ? href : `https://x.com${href}`;
        const tweetId = link.match(/status\/(\d+)/)?.[1];
        if (!tweetId) continue;
        
        // Extract timestamp
        const timeElement = article.querySelector('time');
        let timestamp = timeElement?.getAttribute('datetime');
        const relativeTime = timeElement?.innerText?.trim() || '';
        
        // Parse relative time if no absolute timestamp
        if (!timestamp && relativeTime) {
          if (relativeTime.match(/\d+s/) || relativeTime.toLowerCase().includes('now')) {
            timestamp = new Date().toISOString();
          } else if (relativeTime.match(/\d+m/)) {
            const mins = parseInt(relativeTime) || 1;
            timestamp = new Date(now.getTime() - mins * 60000).toISOString();
          } else if (relativeTime.match(/\d+h/)) {
            const hours = parseInt(relativeTime) || 1;
            timestamp = new Date(now.getTime() - hours * 3600000).toISOString();
          } else if (relativeTime.match(/\d+d/)) {
            const days = parseInt(relativeTime) || 1;
            timestamp = new Date(now.getTime() - days * 86400000).toISOString();
          }
        }
        
        if (!timestamp) continue;
        
        // Extract user display name
        const nameSelectors = [
          '[data-testid="User-Names"] > div:first-child span',
          '[data-testid="User-Name"] span',
          '[data-testid="UserName"] span'
        ];
        
        let displayName = '';
        for (const selector of nameSelectors) {
          const nameElement = article.querySelector(selector);
          if (nameElement?.textContent?.trim() && 
              !nameElement.textContent.startsWith('@')) {
            displayName = nameElement.textContent.trim();
            break;
          }
        }
        
        // Extract engagement metrics
        const getMetric = (testId, fallbackSelectors = []) => {
          let element = article.querySelector(`[data-testid="${testId}"]`);
          
          if (!element) {
            for (const fallback of fallbackSelectors) {
              element = article.querySelector(fallback);
              if (element) break;
            }
          }
          
          if (!element) return 0;
          
          const text = element.getAttribute('aria-label') || element.textContent || '';
          const match = text.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/);
          if (!match) return 0;
          
          const value = match[1];
          if (value.includes('K')) return Math.round(parseFloat(value) * 1000);
          if (value.includes('M')) return Math.round(parseFloat(value) * 1000000);
          if (value.includes('B')) return Math.round(parseFloat(value) * 1000000000);
          return parseInt(value.replace(/,/g, ''));
        };
        
        const tweet = {
          id: tweetId,
          username: username.replace('@', ''),
          displayName: displayName || username.replace('@', ''),
          text: tweetText,
          link,
          timestamp,
          relativeTime,
          likes: getMetric('like'),
          retweets: getMetric('retweet'),
          replies: getMetric('reply'),
          views: getMetric('Views', ['[aria-label*="views"]']),
          scraped_at: new Date().toISOString(),
          position: i
        };
        
        tweets.push(tweet);
        console.log(`Extracted tweet ${tweets.length}: "${tweetText.substring(0, 50)}..."`);
        
      } catch (error) {
        console.error(`Error processing article ${i}:`, error.message);
      }
    }
    
    // Sort by timestamp (newest first)
    return tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, username, maxTweets);
}

// Main scraping function
async function scrapeSingleAccount(username, maxTweets = 10) {
  const scrapeId = crypto.randomBytes(6).toString('hex');
  const startTime = Date.now();
  const cleanUsername = username.replace('@', '');
  const profileURL = `https://x.com/${cleanUsername}`;
  
  console.log(`\n🚀 [${scrapeId}] Starting scrape for @${cleanUsername}`);
  
  try {
    const page = await twitterBrowser.getPage();
    
    console.log(`📍 [${scrapeId}] Navigating to ${profileURL}...`);
    const response = await page.goto(profileURL, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    console.log(`✅ [${scrapeId}] Navigation completed (${response?.status()})`);
    
    // Wait for page to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Validate account access
    const validation = await validateAccountAccess(page, cleanUsername);
    if (!validation.valid) {
      return {
        success: false,
        username: cleanUsername,
        error: validation.error,
        error_code: validation.code,
        tweets: [],
        count: 0,
        scraped_at: new Date().toISOString(),
        performance: {
          total_time_ms: Date.now() - startTime,
          scrape_id: scrapeId
        }
      };
    }
    
    console.log(`✅ [${scrapeId}] Account validation passed`);
    
    // Wait for tweets to load
    const tweetSelectors = [
      'article[data-testid="tweet"]',
      'article[role="article"]',
      'div[data-testid="tweet"]'
    ];
    
    let tweetsLoaded = false;
    for (const selector of tweetSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 15000 });
        console.log(`✅ [${scrapeId}] Tweets loaded with selector: ${selector}`);
        tweetsLoaded = true;
        break;
      } catch (e) {
        console.log(`⏳ [${scrapeId}] Trying next selector...`);
      }
    }
    
    if (!tweetsLoaded) {
      return {
        success: false,
        username: cleanUsername,
        error: 'No tweets found - account may have no tweets, be rate limited, or require authentication',
        error_code: 'NO_TWEETS_FOUND',
        tweets: [],
        count: 0,
        scraped_at: new Date().toISOString(),
        performance: {
          total_time_ms: Date.now() - startTime,
          scrape_id: scrapeId
        }
      };
    }
    
    // Scroll to load more tweets
    console.log(`🔄 [${scrapeId}] Loading more tweets...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Return to top for consistent extraction
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract tweets
    const tweets = await extractTweets(page, cleanUsername, maxTweets);
    
    // Filter tweets by freshness (default 7 days)
    const freshnessDays = parseInt(process.env.TWEET_FRESHNESS_DAYS) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - freshnessDays);
    
    const freshTweets = tweets.filter(tweet => {
      const tweetDate = new Date(tweet.timestamp);
      return tweetDate > cutoffDate;
    }).slice(0, maxTweets);
    
    const totalTime = Date.now() - startTime;
    console.log(`🎉 [${scrapeId}] Successfully scraped ${freshTweets.length} tweets in ${totalTime}ms`);
    
    return {
      success: true,
      username: cleanUsername,
      displayName: freshTweets[0]?.displayName || cleanUsername,
      tweets: freshTweets,
      count: freshTweets.length,
      requested: maxTweets,
      profile_url: profileURL,
      freshness_days: freshnessDays,
      scraped_at: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        scrape_id: scrapeId,
        validation_passed: true,
        tweets_loaded: true
      }
    };
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [${scrapeId}] Scraping failed:`, error.message);
    
    // Categorize errors
    let errorCode = 'UNKNOWN_ERROR';
    if (error.message.includes('timeout')) errorCode = 'TIMEOUT';
    else if (error.message.includes('navigation')) errorCode = 'NAVIGATION_ERROR';
    else if (error.message.includes('Protocol error')) errorCode = 'CONNECTION_ERROR';
    
    return {
      success: false,
      username: cleanUsername,
      error: error.message,
      error_code: errorCode,
      tweets: [],
      count: 0,
      scraped_at: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        scrape_id: scrapeId
      }
    };
  }
}

// API Endpoints

// Health check
app.get('/', (req, res) => {
  const stats = twitterBrowser.getStats();
  res.json({
    status: 'Enhanced Single Account Twitter Scraper',
    version: '2.0',
    chrome: twitterBrowser.findChrome() || 'default',
    browser: stats,
    cookies_configured: !!process.env.TWITTER_COOKIES,
    timestamp: new Date().toISOString(),
    features: [
      'Enhanced Error Detection',
      'Accurate Account Status Detection', 
      'Advanced Tweet Extraction',
      'Stealth Browser Configuration',
      'Automatic Cookie Management'
    ]
  });
});

// Scrape by URL
app.post('/scrape', async (req, res) => {
  const { url, maxTweets = 10 } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'Twitter URL is required',
      example: 'https://x.com/elonmusk'
    });
  }
  
  // Extract username from URL
  const usernameMatch = url.match(/(?:x\.com|twitter\.com)\/([^\/\?]+)/);
  if (!usernameMatch) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Twitter URL format',
      provided: url,
      expected: 'https://x.com/username'
    });
  }
  
  const username = usernameMatch[1];
  const result = await scrapeSingleAccount(username, maxTweets);
  
  const statusCode = result.success ? 200 : 
                    result.error_code === 'AUTH_REQUIRED' ? 401 :
                    result.error_code === 'RATE_LIMITED' ? 429 :
                    result.error_code === 'NOT_FOUND' ? 404 : 500;
  
  res.status(statusCode).json(result);
});

// Scrape by username
app.post('/scrape-user', async (req, res) => {
  const { username, maxTweets = 10 } = req.body;
  
  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required',
      example: 'elonmusk or @elonmusk'
    });
  }
  
  const result = await scrapeSingleAccount(username, maxTweets);
  
  const statusCode = result.success ? 200 : 
                    result.error_code === 'AUTH_REQUIRED' ? 401 :
                    result.error_code === 'RATE_LIMITED' ? 429 :
                    result.error_code === 'NOT_FOUND' ? 404 : 500;
  
  res.status(statusCode).json(result);
});

// Get browser stats
app.get('/stats', (req, res) => {
  const stats = twitterBrowser.getStats();
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  
  res.json({
    server: {
      uptime_seconds: Math.round(uptime),
      uptime_formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory_usage_mb: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heap_used: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total: Math.round(memUsage.heapTotal / 1024 / 1024)
      },
      node_version: process.version
    },
    browser: stats,
    chrome_path: twitterBrowser.findChrome() || 'default',
    environment: {
      cookies_configured: !!process.env.TWITTER_COOKIES,
      tweet_freshness_days: process.env.TWEET_FRESHNESS_DAYS || 7,
      port: process.env.PORT || 3000
    },
    timestamp: new Date().toISOString()
  });
});

// Restart browser
app.post('/restart-browser', async (req, res) => {
  try {
    await twitterBrowser.restart();
    res.json({
      success: true,
      message: 'Browser restarted successfully',
      new_instance_id: twitterBrowser.instanceId,
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

// Test endpoint for quick validation
app.get('/test/:username', async (req, res) => {
  const { username } = req.params;
  const maxTweets = parseInt(req.query.maxTweets) || 3;
  
  console.log(`🧪 Testing scrape for @${username} (${maxTweets} tweets)`);
  
  const result = await scrapeSingleAccount(username, maxTweets);
  
  // Return simplified response for testing
  const testResult = {
    success: result.success,
    username: result.username,
    tweet_count: result.count,
    error: result.error || null,
    error_code: result.error_code || null,
    sample_tweet: result.tweets[0]?.text?.substring(0, 100) + '...' || null,
    performance_ms: result.performance?.total_time_ms,
    scraped_at: result.scraped_at
  };
  
  res.json(testResult);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    available_endpoints: [
      'GET  / - Health check',
      'GET  /stats - Browser statistics',
      'GET  /test/:username - Quick test',
      'POST /scrape - Scrape by URL',
      'POST /scrape-user - Scrape by username',
      'POST /restart-browser - Restart browser'
    ],
    timestamp: new Date().toISOString()
  });
});

// Server startup
async function startServer() {
  try {
    console.log('🔥 Initializing Twitter scraper...');
    await twitterBrowser.initialize();
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Enhanced Single Account Twitter Scraper running on port ${PORT}`);
      console.log(`🔍 Chrome: ${twitterBrowser.findChrome() || 'default'}`);
      console.log(`🍪 Cookies: ${process.env.TWITTER_COOKIES ? '✅ Configured' : '❌ Not configured'}`);
      console.log(`🆔 Instance: ${twitterBrowser.instanceId}`);
      console.log(`📊 Freshness: ${process.env.TWEET_FRESHNESS_DAYS || 7} days`);
      
      console.log('\n📡 Available Endpoints:');
      console.log('  GET  /                    - Health check & status');
      console.log('  GET  /stats               - Detailed browser stats');
      console.log('  GET  /test/:username      - Quick test scrape');
      console.log('  POST /scrape              - Scrape by Twitter URL');
      console.log('  POST /scrape-user         - Scrape by username');
      console.log('  POST /restart-browser     - Restart browser');
      
      console.log('\n📝 Usage Examples:');
      console.log('  curl -X POST http://localhost:3000/scrape-user \\');
      console.log('    -H "Content-Type: application/json" \\');
      console.log('    -d \'{"username": "elonmusk", "maxTweets": 5}\'');
      console.log('');
      console.log('  curl -X POST http://localhost:3000/scrape \\');
      console.log('    -H "Content-Type: application/json" \\');
      console.log('    -d \'{"url": "https://x.com/elonmusk", "maxTweets": 10}\'');
      console.log('');
      console.log('  curl http://localhost:3000/test/elonmusk?maxTweets=3');
    });

    // Enhanced error handling
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`💥 Port ${PORT} is already in use`);
        process.exit(1);
      } else {
        console.error('💥 Server error:', error);
      }
    });

  } catch (error) {
    console.error('💥 Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    console.log('🔒 Closing browser...');
    await twitterBrowser.close();
    
    console.log('✅ Cleanup completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart

// Error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
startServer();
