const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const crypto = require('crypto');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Enhanced Browser Pool with better error handling
class TwitterScraperBrowser {
  constructor() {
    this.browser = null;
    this.isInitializing = false;
    this.instanceId = crypto.randomBytes(8).toString('hex');
    this.cookiesLoaded = false;
    this.lastHealthCheck = Date.now();
    
    // Auto health check every 10 minutes
    setInterval(() => this.healthCheck(), 10 * 60 * 1000);
  }

  async initialize() {
    if (this.isInitializing) {
      console.log('⏳ Browser initialization already in progress...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return this.browser;
    }

    if (this.browser && this.browser.isConnected()) {
      console.log('✅ Reusing existing browser instance');
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
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          `--user-data-dir=/tmp/chrome-twitter-${this.instanceId}`,
          '--memory-pressure-off'
        ],
        defaultViewport: { width: 1920, height: 1080 }
      };

      if (chromePath) {
        launchOptions.executablePath = chromePath;
      }

      console.log(`🚀 Launching new browser instance [${this.instanceId}]...`);
      this.browser = await puppeteer.launch(launchOptions);
      
      this.browser.on('disconnected', () => {
        console.log('🔴 Browser disconnected, will reinitialize on next request');
        this.browser = null;
        this.cookiesLoaded = false;
      });

      console.log(`✅ Browser initialized successfully [${this.instanceId}]`);
      this.lastHealthCheck = Date.now();
      
    } catch (error) {
      console.error('💥 Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    if (twitterBrowser.browser) {
      console.log('🔒 Closing browser...');
      await twitterBrowser.browser.close();
    }
    
    console.log('✅ Cleanup completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
startServer();Failed to initialize browser:', error.message);
      this.browser = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }

    return this.browser;
  }

  async createPage() {
    const browser = await this.initialize();
    const page = await browser.newPage();
    
    // Enhanced stealth configuration
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none'
    });

    // Clear storage
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
      
      // Remove webdriver traces
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    // Load cookies if available
    if (!this.cookiesLoaded && process.env.TWITTER_COOKIES) {
      await this.loadCookies(page);
    }

    return page;
  }

  async loadCookies(page) {
    try {
      if (!process.env.TWITTER_COOKIES) return false;

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
        await page.setCookie(...validCookies);
        this.cookiesLoaded = true;
        console.log(`✅ ${validCookies.length} cookies loaded successfully`);
        return true;
      }
      
    } catch (err) {
      console.error('❌ Cookie loading failed:', err.message);
    }
    
    return false;
  }

  async healthCheck() {
    if (!this.browser) return;
    
    try {
      const version = await this.browser.version();
      console.log(`💊 Health check passed [${this.instanceId}] - Browser version: ${version}`);
      this.lastHealthCheck = Date.now();
      
    } catch (error) {
      console.error('💥 Health check failed:', error.message);
      await this.restart();
    }
  }

  async restart() {
    console.log(`🔄 Restarting browser [${this.instanceId}]...`);
    
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch (e) {
      console.error('Error closing browser during restart:', e.message);
    }
    
    this.browser = null;
    this.cookiesLoaded = false;
    this.instanceId = crypto.randomBytes(8).toString('hex');
    
    await this.initialize();
  }

  findChrome() {
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

  getStats() {
    return {
      instance_id: this.instanceId,
      browser_connected: this.browser?.isConnected() || false,
      cookies_loaded: this.cookiesLoaded,
      last_health_check: new Date(this.lastHealthCheck).toISOString(),
      uptime_minutes: Math.round((Date.now() - this.lastHealthCheck) / 60000)
    };
  }
}

// Global browser instance
const twitterBrowser = new TwitterScraperBrowser();

// Enhanced account status detection
async function detectAccountStatus(page, username) {
  const url = page.url().toLowerCase();
  const content = await page.content();
  
  // More precise suspended account detection
  const suspendedIndicators = [
    'account suspended',
    'this account has been suspended',
    'suspended account',
    'account has been suspended'
  ];
  
  // Check for suspended account with multiple methods
  const isSuspended = suspendedIndicators.some(indicator => 
    content.toLowerCase().includes(indicator)
  ) || url.includes('/suspended');
  
  if (isSuspended) {
    return { status: 'suspended', message: `Account @${username} is suspended` };
  }

  // More precise private account detection
  const privateIndicators = [
    'these tweets are protected',
    'this account\'s tweets are protected',
    'protected account',
    'follow to see their tweets'
  ];
  
  const isPrivate = privateIndicators.some(indicator => 
    content.toLowerCase().includes(indicator)
  );
  
  if (isPrivate) {
    return { status: 'private', message: `Account @${username} is private/protected` };
  }

  // Check if account doesn't exist
  const notFoundIndicators = [
    'this account doesn\'t exist',
    'sorry, that page doesn\'t exist',
    'user not found',
    'page doesn\'t exist'
  ];
  
  const notFound = notFoundIndicators.some(indicator => 
    content.toLowerCase().includes(indicator)
  ) || url.includes('/error') || content.includes('404');
  
  if (notFound) {
    return { status: 'not_found', message: `Account @${username} doesn't exist` };
  }

  // Check for rate limiting
  const rateLimitIndicators = [
    'rate limit exceeded',
    'too many requests',
    'try again later',
    'temporarily restricted'
  ];
  
  const isRateLimited = rateLimitIndicators.some(indicator => 
    content.toLowerCase().includes(indicator)
  );
  
  if (isRateLimited) {
    return { status: 'rate_limited', message: 'Rate limited by Twitter - Please try again later' };
  }

  // Check if we're redirected to login
  if (url.includes('/login') || url.includes('/i/flow/login') || url.includes('/i/flow/signup')) {
    return { status: 'auth_required', message: 'Authentication required - Please check your TWITTER_COOKIES' };
  }

  return { status: 'accessible', message: 'Account is accessible' };
}

// Enhanced tweet extraction with better accuracy
async function extractTweets(page, username, maxTweets, scrapeId) {
  console.log(`🎯 [${scrapeId}] Extracting tweets for @${username}...`);
  
  // Wait for content to load with multiple strategies
  const selectors = [
    'article[data-testid="tweet"]',
    'div[data-testid="cellInnerDiv"]',
    'article',
    '[data-testid="tweet"]'
  ];
  
  let contentLoaded = false;
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 10000 });
      console.log(`✅ [${scrapeId}] Content loaded with selector: ${selector}`);
      contentLoaded = true;
      break;
    } catch (e) {
      console.log(`⏳ [${scrapeId}] Trying next selector...`);
    }
  }
  
  if (!contentLoaded) {
    throw new Error('No tweet content found - account may have no tweets or be inaccessible');
  }

  // Light scrolling to load more tweets
  console.log(`🔄 [${scrapeId}] Loading more tweets...`);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Scroll back to top for freshest content
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Extract tweets with improved logic
  const tweets = await page.evaluate((username, maxTweets, scrapeId) => {
    const tweetData = [];
    const articles = document.querySelectorAll('article');
    const now = new Date();
    
    console.log(`Found ${articles.length} articles to process for @${username}`);

    for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
      const article = articles[i];
      
      try {
        // Skip promoted content
        if (article.querySelector('[data-testid="promotedIndicator"]')) {
          continue;
        }

        // More accurate pinned tweet detection
        const isPinned = !!(
          article.querySelector('[data-testid="pin"]') ||
          article.querySelector('svg[data-testid="pin"]') ||
          article.querySelector('[aria-label*="Pinned"]') ||
          (article.querySelector('[data-testid="socialContext"]')?.textContent?.toLowerCase().includes('pinned'))
        );
        
        if (isPinned) {
          console.log(`🔒 [${scrapeId}] Skipping pinned tweet at position ${i}`);
          continue;
        }

        // Extract tweet text with multiple selectors
        let text = '';
        const textSelectors = [
          '[data-testid="tweetText"]',
          '.tweet-text',
          '[lang]'
        ];
        
        for (const selector of textSelectors) {
          const textElement = article.querySelector(selector);
          if (textElement && textElement.innerText.trim()) {
            text = textElement.innerText.trim();
            break;
          }
        }
        
        // Skip if no meaningful text content
        if (!text || text.length < 3) {
          // Check if it has media but no text
          const hasMedia = article.querySelector('img, video') && !article.querySelector('[data-testid="tweetText"]');
          if (!hasMedia) continue;
        }

        // Get tweet link and extract ID
        const linkElement = article.querySelector('a[href*="/status/"]') || 
                           article.querySelector('time')?.closest('a');
        if (!linkElement) continue;
        
        const href = linkElement.getAttribute('href');
        const link = href.startsWith('http') ? href : 'https://x.com' + href;
        const tweetId = link.match(/status\/(\d+)/)?.[1];
        if (!tweetId) continue;

        // Verify this tweet belongs to the target user
        const tweetUsername = link.split('/')[3]; // Extract username from URL
        if (tweetUsername.toLowerCase() !== username.toLowerCase()) {
          continue; // Skip retweets or quotes from other users
        }

        // Get timestamp
        const timeElement = article.querySelector('time');
        let timestamp = timeElement ? timeElement.getAttribute('datetime') : null;
        const relativeTime = timeElement ? timeElement.innerText.trim() : '';

        // Parse relative time if no absolute timestamp
        if (!timestamp && relativeTime) {
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

        if (!timestamp) continue;
        const tweetDate = new Date(timestamp);
        if (isNaN(tweetDate.getTime())) continue;

        // Get user display name
        let displayName = '';
        const nameSelectors = [
          '[data-testid="User-Name"] span',
          '[data-testid="User-Names"] span:first-child',
          '[data-testid="UserName"] span'
        ];
        
        for (const selector of nameSelectors) {
          const nameElement = article.querySelector(selector);
          if (nameElement && nameElement.textContent.trim()) {
            displayName = nameElement.textContent.trim();
            break;
          }
        }

        // Get engagement metrics
        const getMetric = (testId) => {
          const element = article.querySelector(`[data-testid="${testId}"]`);
          if (!element) return 0;
          const text = element.getAttribute('aria-label') || element.textContent || '';
          const match = text.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/);
          if (!match) return 0;
          
          let value = match[1].replace(/,/g, '');
          const multipliers = { 'K': 1000, 'M': 1000000, 'B': 1000000000 };
          const multiplier = multipliers[value.slice(-1)] || 1;
          
          if (multiplier > 1) {
            value = parseFloat(value.slice(0, -1)) * multiplier;
          }
          
          return Math.floor(parseFloat(value)) || 0;
        };

        // Check if tweet has media
        const hasImages = article.querySelectorAll('img[src*="pbs.twimg.com"]').length > 0;
        const hasVideo = article.querySelector('video') !== null;

        const tweetObj = {
          id: tweetId,
          username: username.replace('@', ''),
          displayName: displayName || username,
          text: text || (hasImages ? '[Image]' : hasVideo ? '[Video]' : ''),
          link,
          likes: getMetric('like'),
          retweets: getMetric('retweet'),
          replies: getMetric('reply'),
          timestamp,
          relativeTime,
          hasMedia: hasImages || hasVideo,
          mediaType: hasVideo ? 'video' : hasImages ? 'image' : null,
          scraped_at: new Date().toISOString()
        };
        
        tweetData.push(tweetObj);
        console.log(`✅ Extracted tweet ${tweetData.length}: ${text.substring(0, 50)}...`);

      } catch (e) {
        console.error(`Error processing article ${i}:`, e.message);
      }
    }

    // Sort by timestamp (newest first)
    const sortedTweets = tweetData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    console.log(`📊 Extracted ${sortedTweets.length} tweets for @${username}`);
    return sortedTweets;
  }, username, maxTweets, scrapeId);

  return tweets;
}

// Main scraping function
async function scrapeSingleAccount(username, maxTweets = 10) {
  const scrapeId = crypto.randomBytes(6).toString('hex');
  const startTime = Date.now();
  const cleanUsername = username.replace('@', '');
  const profileURL = `https://x.com/${cleanUsername}`;
  
  console.log(`\n🚀 [${scrapeId}] Starting scrape for @${cleanUsername}`);
  console.log(`🔗 Profile URL: ${profileURL}`);

  let page;
  try {
    // Create new page
    page = await twitterBrowser.createPage();
    console.log(`📄 [${scrapeId}] Page created successfully`);

    // Navigate to profile
    console.log(`🎯 [${scrapeId}] Navigating to profile...`);
    const response = await page.goto(profileURL, { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log(`✅ [${scrapeId}] Navigation completed, status: ${response?.status()}`);

    // Wait for page to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Detect account status
    const accountStatus = await detectAccountStatus(page, cleanUsername);
    console.log(`🔍 [${scrapeId}] Account status: ${accountStatus.status}`);

    if (accountStatus.status !== 'accessible') {
      return {
        success: false,
        username: cleanUsername,
        error: accountStatus.message,
        status: accountStatus.status,
        tweets: [],
        count: 0,
        scraped_at: new Date().toISOString(),
        performance: {
          total_time_ms: Date.now() - startTime,
          scrape_id: scrapeId
        }
      };
    }

    // Extract tweets
    const tweets = await extractTweets(page, cleanUsername, maxTweets, scrapeId);

    // Filter by freshness if specified
    const freshnessDays = parseInt(process.env.TWEET_FRESHNESS_DAYS) || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - freshnessDays);

    const filteredTweets = tweets.filter(tweet => {
      const tweetDate = new Date(tweet.timestamp);
      return tweetDate > cutoff;
    }).slice(0, maxTweets);

    const totalTime = Date.now() - startTime;
    const success = filteredTweets.length > 0;

    console.log(`\n🎉 [${scrapeId}] Scraping completed in ${totalTime}ms`);
    console.log(`📊 Results: ${filteredTweets.length}/${tweets.length} tweets (after freshness filter)`);

    return {
      success,
      username: cleanUsername,
      displayName: tweets[0]?.displayName || cleanUsername,
      profile_url: profileURL,
      tweets: filteredTweets,
      count: filteredTweets.length,
      requested: maxTweets,
      total_found: tweets.length,
      freshness_days: freshnessDays,
      scraped_at: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        scrape_id: scrapeId,
        browser_instance: twitterBrowser.instanceId
      },
      ...(success ? {} : { 
        warning: filteredTweets.length === 0 ? 
          'No recent tweets found within the freshness period' : 
          'Limited results - account may be rate limited or have restricted access'
      })
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [${scrapeId}] Scraping failed:`, error.message);
    
    return {
      success: false,
      username: cleanUsername,
      error: error.message,
      tweets: [],
      count: 0,
      scraped_at: new Date().toISOString(),
      performance: {
        total_time_ms: totalTime,
        scrape_id: scrapeId,
        browser_instance: twitterBrowser.instanceId
      }
    };
  } finally {
    // Close page
    if (page) {
      try {
        await page.close();
        console.log(`📄 [${scrapeId}] Page closed successfully`);
      } catch (e) {
        console.error(`❌ [${scrapeId}] Error closing page:`, e.message);
      }
    }
  }
}

// API Endpoints

// Health check
app.get('/', (req, res) => {
  const stats = twitterBrowser.getStats();
  res.json({
    status: 'Enhanced Twitter Single Account Scraper',
    version: '2.0.0',
    browser_stats: stats,
    chrome_path: twitterBrowser.findChrome() || 'default',
    cookies_configured: !!process.env.TWITTER_COOKIES,
    timestamp: new Date().toISOString(),
    features: [
      'Enhanced Account Status Detection',
      'Accurate Tweet Extraction',
      'Pinned Tweet Filtering',
      'Media Content Support',
      'Rate Limit Protection',
      'Browser Pool Management'
    ]
  });
});

// Single account scraper - URL based
app.post('/scrape', async (req, res) => {
  const { url, maxTweets = 10 } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      success: false,
      error: 'Twitter profile URL is required',
      example: 'https://x.com/username or https://twitter.com/username'
    });
  }

  // Extract username from URL
  const usernameMatch = url.match(/(?:x\.com|twitter\.com)\/([^\/\?#]+)/);
  if (!usernameMatch) {
    return res.status(400).json({ 
      success: false,
      error: 'Invalid Twitter URL format',
      provided: url,
      expected: 'https://x.com/username or https://twitter.com/username'
    });
  }

  const username = usernameMatch[1];
  
  if (maxTweets > 50) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 50 tweets allowed per request'
    });
  }

  try {
    const result = await scrapeSingleAccount(username, maxTweets);
    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Single account scraper - username based
app.post('/scrape-user', async (req, res) => {
  const { username, maxTweets = 10 } = req.body;
  
  if (!username) {
    return res.status(400).json({ 
      success: false,
      error: 'Username is required',
      example: 'username or @username'
    });
  }
  
  if (maxTweets > 50) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 50 tweets allowed per request'
    });
  }

  try {
    const result = await scrapeSingleAccount(username, maxTweets);
    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Browser management
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

// Detailed stats
app.get('/stats', (req, res) => {
  const stats = twitterBrowser.getStats();
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  
  res.json({
    server: {
      uptime_seconds: Math.round(uptime),
      uptime_formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      memory_usage_mb: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heap_used: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total: Math.round(memUsage.heapTotal / 1024 / 1024)
      },
      node_version: process.version,
      platform: process.platform
    },
    browser: stats,
    configuration: {
      chrome_path: twitterBrowser.findChrome() || 'default',
      cookies_configured: !!process.env.TWITTER_COOKIES,
      default_freshness_days: process.env.TWEET_FRESHNESS_DAYS || 30
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
async function startServer() {
  try {
    console.log('🔥 Initializing Twitter scraper browser...');
    await twitterBrowser.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Enhanced Twitter Scraper running on port ${PORT}`);
      console.log(`🔍 Chrome: ${twitterBrowser.findChrome() || 'default'}`);
      console.log(`🍪 Cookies: ${process.env.TWITTER_COOKIES ? '✅ Configured' : '❌ Not configured'}`);
      console.log(`🆔 Browser ID: ${twitterBrowser.instanceId}`);
      console.log(`\n📡 Available Endpoints:`);
      console.log(`  GET  /              - Health check & status`);
      console.log(`  GET  /stats         - Detailed stats`);
      console.log(`  POST /scrape        - Scrape by URL`);
      console.log(`  POST /scrape-user   - Scrape by username`);
      console.log(`  POST /restart-browser - Restart browser`);
      console.log(`\n✨ Features:`);
      console.log(`  • Accurate account status detection`);
      console.log(`  • Smart pinned tweet filtering`);
      console.log(`  • Media content support`);
      console.log(`  • Rate limit protection`);
      console.log(`  • Enhanced error handling`);
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
    if (browserManager.browser) {
      console.log('🔒 Closing browser...');
      await browserManager.browser.close();
    }
    console.log('✅ Shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

// Handle uncaught errors
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
