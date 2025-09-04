const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const crypto = require('crypto');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 🔥 ENHANCED BROWSER MANAGER FOR SINGLE ACCOUNT SCRAPING
class TwitterScraperBrowser {
  constructor() {
    this.browser = null;
    this.isInitializing = false;
    this.cookiesLoaded = false;
    this.lastHealthCheck = Date.now();
    this.instanceId = crypto.randomBytes(8).toString('hex');
    this.activeScrapes = new Set();
    this.maxConcurrentScrapes = 3;
    
    // Auto health check every 10 minutes
    setInterval(() => this.healthCheck(), 10 * 60 * 1000);
  }

  async initialize() {
    if (this.isInitializing) {
      console.log('⏳ Browser initialization in progress, waiting...');
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
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--window-size=1366,768',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          `--user-data-dir=/tmp/twitter-scraper-${this.instanceId}`,
          '--memory-pressure-off',
          '--max_old_space_size=512'
        ],
        defaultViewport: { width: 1366, height: 768 },
        timeout: 30000
      };

      if (chromePath) {
        launchOptions.executablePath = chromePath;
      }

      console.log(`🚀 Launching browser instance [${this.instanceId}]...`);
      this.browser = await puppeteer.launch(launchOptions);
      
      this.browser.on('disconnected', () => {
        console.log('🔴 Browser disconnected, marking for reinit');
        this.browser = null;
        this.cookiesLoaded = false;
        this.activeScrapes.clear();
      });

      console.log(`✅ Browser initialized successfully [${this.instanceId}]`);
      this.lastHealthCheck = Date.now();
      
    } catch (error) {
      console.error('💥 Browser initialization failed:', error.message);
      this.browser = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }

    return this.browser;
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
    
    console.log('⚠️ Using default Chrome executable');
    return null;
  }

  async createOptimizedPage(scrapeId) {
    // Check concurrent scrape limit
    if (this.activeScrapes.size >= this.maxConcurrentScrapes) {
      throw new Error(`Maximum concurrent scrapes (${this.maxConcurrentScrapes}) reached. Please try again.`);
    }

    const browser = await this.initialize();
    const page = await browser.newPage();
    
    this.activeScrapes.add(scrapeId);
    
    // Configure page for Twitter scraping
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none'
    });

    // Clear storage and inject stealth scripts
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        
        // Remove webdriver traces
        delete navigator.__proto__.webdriver;
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        // Mock plugins and languages
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        
      } catch (e) {
        console.log('Storage clear failed:', e.message);
      }
    });

    // Load cookies if available
    await this.loadCookies(page);

    console.log(`📄 Created optimized page for scrape ${scrapeId}`);
    return page;
  }

  async loadCookies(page) {
    try {
      if (!process.env.TWITTER_COOKIES || this.cookiesLoaded) return false;

      let cookies;
      
      try {
        cookies = JSON.parse(process.env.TWITTER_COOKIES);
      } catch (e) {
        console.log('⚠️ Invalid TWITTER_COOKIES format');
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
        cookie.name && cookie.value && cookie.domain &&
        (cookie.domain.includes('twitter.com') || cookie.domain.includes('x.com'))
      );
      
      if (validCookies.length > 0) {
        await page.setCookie(...validCookies);
        this.cookiesLoaded = true;
        console.log(`✅ Loaded ${validCookies.length} cookies`);
        return true;
      }
      
    } catch (err) {
      console.error('❌ Cookie loading failed:', err.message);
    }
    
    return false;
  }

  async closePage(page, scrapeId) {
    try {
      await page.close();
      this.activeScrapes.delete(scrapeId);
      console.log(`📄 Closed page for scrape ${scrapeId}`);
    } catch (e) {
      console.error('Error closing page:', e.message);
    }
  }

  async healthCheck() {
    if (!this.browser || !this.browser.isConnected()) return;
    
    try {
      const version = await this.browser.version();
      console.log(`💊 Health check passed [${this.instanceId}] - ${version}`);
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
      console.error('Error during restart:', e.message);
    }
    
    this.browser = null;
    this.cookiesLoaded = false;
    this.activeScrapes.clear();
    this.instanceId = crypto.randomBytes(8).toString('hex');
    
    await this.initialize();
  }

  getStats() {
    return {
      instance_id: this.instanceId,
      browser_connected: this.browser?.isConnected() || false,
      active_scrapes: this.activeScrapes.size,
      max_concurrent_scrapes: this.maxConcurrentScrapes,
      cookies_loaded: this.cookiesLoaded,
      last_health_check: new Date(this.lastHealthCheck).toISOString(),
      uptime_minutes: Math.round((Date.now() - this.lastHealthCheck) / 60000)
    };
  }
}

// Global browser manager
const browserManager = new TwitterScraperBrowser();

// 🎯 CORE SINGLE ACCOUNT SCRAPER FUNCTION
async function scrapeSingleAccount(username, maxTweets = 10, freshnessDays = 7) {
  const scrapeId = crypto.randomBytes(6).toString('hex');
  const startTime = Date.now();
  const cleanUsername = username.replace('@', '');
  
  console.log(`\n🎯 [${scrapeId}] Starting scrape for @${cleanUsername}`);
  
  let page;
  try {
    page = await browserManager.createOptimizedPage(scrapeId);
    
    // Navigate to profile
    const profileURL = `https://x.com/${cleanUsername}`;
    console.log(`📍 [${scrapeId}] Navigating to ${profileURL}`);
    
    const response = await page.goto(profileURL, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log(`✅ [${scrapeId}] Navigation completed, status: ${response?.status()}`);

    // Enhanced error detection
    const currentUrl = page.url();
    const pageContent = await page.content();
    
    // Check for various error conditions
    if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
      throw new Error('Authentication required - redirected to login');
    }
    
    if (pageContent.includes('rate limit') || pageContent.includes('Rate limit exceeded')) {
      throw new Error('Rate limited by Twitter - try again later');
    }
    
    if (pageContent.includes('Account suspended') || pageContent.includes('suspended')) {
      throw new Error(`Account @${cleanUsername} is suspended`);
    }
    
    if (pageContent.includes('doesn\'t exist') || pageContent.includes('page doesn\'t exist')) {
      throw new Error(`Account @${cleanUsername} doesn't exist`);
    }
    
    if (pageContent.includes('Tweets are protected') || pageContent.includes('protected')) {
      throw new Error(`Account @${cleanUsername} is private/protected`);
    }

    // Wait for tweets to load
    console.log(`⏳ [${scrapeId}] Waiting for tweets to load...`);
    
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
      console.log(`✅ [${scrapeId}] Tweets loaded successfully`);
    } catch (e) {
      // Try alternative selectors
      const alternatives = [
        'article',
        '[data-testid="tweetText"]',
        '[data-testid="tweet"]'
      ];
      
      let found = false;
      for (const selector of alternatives) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          found = true;
          break;
        } catch (e) {
          continue;
        }
      }
      
      if (!found) {
        throw new Error('No tweets found - account may be empty, private, or rate limited');
      }
    }

    // Allow content to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Scroll to top for freshest content
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Light scrolling to load more tweets
    console.log(`🔄 [${scrapeId}] Loading additional tweets...`);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Return to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract tweets with comprehensive parsing
    console.log(`🎯 [${scrapeId}] Extracting tweets...`);
    const tweets = await page.evaluate((username, maxTweets, scrapeId, freshnessDays) => {
      const tweetData = [];
      const articles = document.querySelectorAll('article');
      const now = new Date();
      const cutoffDate = new Date(now.getTime() - (freshnessDays * 24 * 60 * 60 * 1000));

      console.log(`Processing ${articles.length} articles for @${username}`);

      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];
        
        try {
          // Skip promoted content
          if (article.querySelector('[data-testid="promotedIndicator"]') || 
              article.querySelector('[aria-label*="Promoted"]')) {
            continue;
          }

          // Enhanced pinned tweet detection
          const isPinned = (
            article.querySelector('[data-testid="pin"]') ||
            article.querySelector('svg[data-testid="pin"]') ||
            article.querySelector('[aria-label*="Pinned"]') ||
            article.textContent.toLowerCase().includes('pinned tweet')
          );
          
          if (isPinned) {
            console.log(`Skipping pinned tweet at position ${i}`);
            continue;
          }

          // Extract tweet text with multiple strategies
          let tweetText = '';
          const textSelectors = [
            '[data-testid="tweetText"]',
            '.tweet-text',
            '[lang]:not([data-testid="UserName"])',
            'div[dir="ltr"]:not([data-testid="UserName"])'
          ];
          
          for (const selector of textSelectors) {
            const textElement = article.querySelector(selector);
            if (textElement && textElement.innerText.trim() && textElement.innerText.length > 3) {
              tweetText = textElement.innerText.trim();
              break;
            }
          }
          
          // Skip if no meaningful text content
          if (!tweetText || tweetText.length < 3) continue;

          // Get tweet link and ID
          const linkElement = article.querySelector('a[href*="/status/"]') || 
                             article.querySelector('time')?.closest('a');
          if (!linkElement) continue;
          
          const href = linkElement.getAttribute('href');
          const tweetLink = href.startsWith('http') ? href : 'https://x.com' + href;
          const tweetIdMatch = tweetLink.match(/status\/(\d+)/);
          if (!tweetIdMatch) continue;
          
          const tweetId = tweetIdMatch[1];

          // Enhanced timestamp extraction
          const timeElement = article.querySelector('time');
          let timestamp = timeElement ? timeElement.getAttribute('datetime') : null;
          const relativeTime = timeElement ? timeElement.innerText.trim() : '';

          // Parse relative timestamps if no absolute time
          if (!timestamp && relativeTime) {
            const now = new Date();
            
            if (relativeTime.includes('s') || relativeTime.toLowerCase().includes('now')) {
              timestamp = new Date().toISOString();
            } else if (relativeTime.includes('m')) {
              const minutes = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
              timestamp = new Date(now.getTime() - minutes * 60000).toISOString();
            } else if (relativeTime.includes('h')) {
              const hours = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
              timestamp = new Date(now.getTime() - hours * 3600000).toISOString();
            } else if (relativeTime.includes('d')) {
              const days = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
              timestamp = new Date(now.getTime() - days * 86400000).toISOString();
            } else {
              // For older tweets, try to parse the text
              timestamp = new Date().toISOString();
            }
          }

          if (!timestamp) continue;
          
          const tweetDate = new Date(timestamp);
          if (isNaN(tweetDate.getTime()) || tweetDate < cutoffDate) continue;

          // Extract display name
          let displayName = username;
          const nameElement = article.querySelector('[data-testid="User-Names"] span:first-child') ||
                            article.querySelector('[data-testid="User-Name"] span') ||
                            article.querySelector('[data-testid="UserName"] span');
          
          if (nameElement && nameElement.textContent.trim()) {
            displayName = nameElement.textContent.trim();
          }

          // Extract engagement metrics
          const getMetric = (testId) => {
            const element = article.querySelector(`[data-testid="${testId}"]`);
            if (!element) return 0;
            
            const ariaLabel = element.getAttribute('aria-label') || '';
            const textContent = element.textContent || '';
            const text = ariaLabel || textContent;
            
            const match = text.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/i);
            if (!match) return 0;
            
            let num = match[1].replace(/,/g, '');
            const multiplier = num.slice(-1).toLowerCase();
            const value = parseFloat(num);
            
            switch (multiplier) {
              case 'k': return Math.round(value * 1000);
              case 'm': return Math.round(value * 1000000);
              case 'b': return Math.round(value * 1000000000);
              default: return Math.round(parseFloat(num)) || 0;
            }
          };

          // Check for media content
          const hasImage = !!article.querySelector('img[src*="pbs.twimg.com"]');
          const hasVideo = !!article.querySelector('video') || !!article.querySelector('[data-testid="videoPlayer"]');
          const hasGif = !!article.querySelector('[data-testid="gif"]');

          const tweet = {
            id: tweetId,
            username: username.replace('@', ''),
            displayName,
            text: tweetText,
            link: tweetLink,
            timestamp,
            relativeTime,
            engagement: {
              likes: getMetric('like'),
              retweets: getMetric('retweet'), 
              replies: getMetric('reply'),
              views: getMetric('views') || 0
            },
            media: {
              hasImage,
              hasVideo,
              hasGif,
              hasMedia: hasImage || hasVideo || hasGif
            },
            scraped_at: new Date().toISOString()
          };
          
          tweetData.push(tweet);

        } catch (error) {
          console.error(`Error processing article ${i}:`, error.message);
        }
      }

      // Sort by timestamp (newest first)
      const sortedTweets = tweetData.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
      
      console.log(`Successfully extracted ${sortedTweets.length} tweets for @${username}`);
      return sortedTweets;
      
    }, cleanUsername, maxTweets, scrapeId, freshnessDays);

    const totalTime = Date.now() - startTime;
    
    console.log(`\n🎉 [${scrapeId}] Scraping completed in ${totalTime}ms`);
    console.log(`📊 Extracted ${tweets.length} tweets for @${cleanUsername}`);

    return {
      success: true,
      username: cleanUsername,
      tweets,
      count: tweets.length,
      requested: maxTweets,
      performance: {
        scrape_time_ms: totalTime,
        instance_id: browserManager.instanceId
      },
      scraped_at: new Date().toISOString()
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
      performance: {
        scrape_time_ms: totalTime,
        instance_id: browserManager.instanceId
      },
      scraped_at: new Date().toISOString()
    };
  } finally {
    if (page) {
      await browserManager.closePage(page, scrapeId);
    }
  }
}

// 🌐 API ENDPOINTS

// Health check endpoint
app.get('/', (req, res) => {
  const chromePath = browserManager.findChrome();
  const stats = browserManager.getStats();
  
  res.json({
    status: 'Enhanced Single Account Twitter Scraper',
    version: '2.0.0',
    chrome_executable: chromePath || 'default',
    browser_stats: stats,
    cookies_configured: !!process.env.TWITTER_COOKIES,
    timestamp: new Date().toISOString(),
    features: [
      'Single Account Optimization',
      'Enhanced Error Detection',
      'Cookie Support',
      'Rate Limit Protection',
      'Media Detection',
      'Engagement Metrics'
    ]
  });
});

// Main scraping endpoint - by username
app.post('/scrape', async (req, res) => {
  const { username, maxTweets = 10, freshnessDays = 7 } = req.body;
  
  if (!username) {
    return res.status(400).json({ 
      success: false,
      error: 'Username is required',
      example: { username: 'elonmusk', maxTweets: 10, freshnessDays: 7 }
    });
  }

  const result = await scrapeSingleAccount(username, maxTweets, freshnessDays);
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

// Scrape by profile URL
app.post('/scrape-url', async (req, res) => {
  const { url, maxTweets = 10, freshnessDays = 7 } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      success: false,
      error: 'Twitter profile URL is required',
      example: { url: 'https://x.com/elonmusk', maxTweets: 10 }
    });
  }

  const usernameMatch = url.match(/(?:twitter\.com|x\.com)\/([^\/\?]+)/);
  if (!usernameMatch) {
    return res.status(400).json({ 
      success: false,
      error: 'Invalid Twitter/X URL format'
    });
  }

  const username = usernameMatch[1];
  const result = await scrapeSingleAccount(username, maxTweets, freshnessDays);
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

// Browser restart endpoint
app.post('/restart-browser', async (req, res) => {
  try {
    await browserManager.restart();
    res.json({ 
      success: true, 
      message: 'Browser restarted successfully',
      new_instance_id: browserManager.instanceId,
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

// Detailed stats endpoint
app.get('/stats', (req, res) => {
  const stats = browserManager.getStats();
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
      node_version: process.version,
      platform: process.platform
    },
    browser: stats,
    chrome_path: browserManager.findChrome() || 'default',
    cookies_configured: !!process.env.TWITTER_COOKIES,
    timestamp: new Date().toISOString()
  });
});

// Initialize browser and start server
async function startServer() {
  try {
    console.log('🔥 Initializing Twitter scraper browser...');
    await browserManager.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Enhanced Single Account Twitter Scraper running on port ${PORT}`);
      console.log(`🔍 Chrome: ${browserManager.findChrome() || 'default'}`);
      console.log(`🍪 Cookies: ${!!process.env.TWITTER_COOKIES ? 'configured' : 'not configured'}`);
      console.log(`🔥 Browser ready with ID: ${browserManager.instanceId}`);
      
      console.log(`\n📡 Available Endpoints:`);
      console.log(`  GET  /              - Health check & status`);
      console.log(`  GET  /stats         - Detailed server stats`);
      console.log(`  POST /scrape        - Scrape by username`);
      console.log(`  POST /scrape-url    - Scrape by profile URL`);
      console.log(`  POST /restart-browser - Restart browser`);
      
      console.log(`\n📝 Usage Examples:`);
      console.log(`  POST /scrape`);
      console.log(`  {`);
      console.log(`    "username": "elonmusk",`);
      console.log(`    "maxTweets": 10,`);
      console.log(`    "freshnessDays": 7`);
      console.log(`  }`);
      
      console.log(`\n  POST /scrape-url`);
      console.log(`  {`);
      console.log(`    "url": "https://x.com/elonmusk",`);
      console.log(`    "maxTweets": 15`);
      console.log(`  }`);
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
