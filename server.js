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

// 🎯 CORE SINGLE ACCOUNT SCRAPER FUNCTION WITH FIXED DETECTION LOGIC
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

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const currentUrl = page.url();
    console.log(`🔍 [${scrapeId}] Current URL: ${currentUrl}`);
    
    // COMPLETELY REWRITTEN ERROR DETECTION LOGIC
    const pageAnalysis = await page.evaluate((username) => {
      const analysis = {
        currentUrl: window.location.href,
        pageTitle: document.title,
        bodyText: document.body ? document.body.innerText.toLowerCase() : '',
        hasLoginForm: false,
        hasRateLimitMessage: false,
        hasSuspensionMessage: false,
        hasProtectedMessage: false,
        hasNotFoundMessage: false,
        hasProfileElements: false,
        hasArticles: false,
        articleCount: 0,
        debugInfo: []
      };
      
      // Check for login redirect (most reliable)
      if (analysis.currentUrl.includes('/login') || analysis.currentUrl.includes('/i/flow/login')) {
        analysis.hasLoginForm = true;
        analysis.debugInfo.push('Redirected to login page');
        return analysis;
      }
      
      // Check for profile elements to see if we're on a profile page
      const profileIndicators = [
        '[data-testid="UserName"]',
        '[data-testid="User-Names"]',
        '[data-testid="UserDescription"]',
        '[data-testid="followersCount"]',
        '[data-testid="followingCount"]'
      ];
      
      analysis.hasProfileElements = profileIndicators.some(selector => document.querySelector(selector));
      if (analysis.hasProfileElements) {
        analysis.debugInfo.push('Profile elements detected');
      }
      
      // Check for articles/tweets
      const articles = document.querySelectorAll('article');
      analysis.hasArticles = articles.length > 0;
      analysis.articleCount = articles.length;
      analysis.debugInfo.push(`Found ${articles.length} article elements`);
      
      // VERY SPECIFIC error message detection
      const bodyText = analysis.bodyText;
      
      // Rate limit - look for very specific messages
      const rateLimitIndicators = [
        'rate limit exceeded',
        'too many requests',
        'try again later'
      ];
      analysis.hasRateLimitMessage = rateLimitIndicators.some(indicator => bodyText.includes(indicator));
      
      // Suspension - ONLY if explicitly stated
      const suspensionIndicators = [
        'this account has been suspended',
        'account suspended for violating',
        'permanently suspended'
      ];
      analysis.hasSuspensionMessage = suspensionIndicators.some(indicator => bodyText.includes(indicator));
      
      // Protected account - specific messages only
      const protectedIndicators = [
        'this account\'s tweets are protected',
        'these tweets are protected',
        'you\'re not authorized to see these tweets'
      ];
      analysis.hasProtectedMessage = protectedIndicators.some(indicator => bodyText.includes(indicator));
      
      // Account not found - specific messages only
      const notFoundIndicators = [
        'this account doesn\'t exist',
        'sorry, that page doesn\'t exist',
        'user not found'
      ];
      analysis.hasNotFoundMessage = notFoundIndicators.some(indicator => bodyText.includes(indicator));
      
      // Add some key page text for debugging
      if (bodyText.length > 0) {
        analysis.debugInfo.push(`Page contains text: ${bodyText.substring(0, 200)}...`);
      }
      
      return analysis;
    }, cleanUsername);
    
    console.log(`🔍 [${scrapeId}] Page analysis:`, {
      url: pageAnalysis.currentUrl,
      title: pageAnalysis.pageTitle,
      hasProfile: pageAnalysis.hasProfileElements,
      articles: pageAnalysis.articleCount,
      errors: {
        login: pageAnalysis.hasLoginForm,
        rateLimit: pageAnalysis.hasRateLimitMessage,
        suspended: pageAnalysis.hasSuspensionMessage,
        protected: pageAnalysis.hasProtectedMessage,
        notFound: pageAnalysis.hasNotFoundMessage
      }
    });
    
    // Act on the analysis with MUCH more specific logic
    if (pageAnalysis.hasLoginForm) {
      throw new Error('Authentication required - redirected to login page');
    }
    
    if (pageAnalysis.hasRateLimitMessage) {
      throw new Error('Rate limited by Twitter - try again in a few minutes');
    }
    
    if (pageAnalysis.hasSuspensionMessage) {
      throw new Error(`Account @${cleanUsername} is suspended`);
    }
    
    if (pageAnalysis.hasNotFoundMessage) {
      throw new Error(`Account @${cleanUsername} doesn't exist`);
    }
    
    if (pageAnalysis.hasProtectedMessage) {
      throw new Error(`Account @${cleanUsername} is private/protected`);
    }
    
    // If we have profile elements, we're good to continue even without articles yet
    if (!pageAnalysis.hasProfileElements) {
      console.log(`⚠️ [${scrapeId}] No profile elements found, checking for generic content...`);
      
      // Final fallback check for any recognizable Twitter content
      const hasTwitterContent = await page.evaluate(() => {
        return document.querySelector('[data-testid]') || 
               document.querySelector('[aria-label]') ||
               document.body.innerText.toLowerCase().includes('twitter') ||
               document.body.innerText.toLowerCase().includes('x.com');
      });
      
      if (!hasTwitterContent) {
        throw new Error(`Cannot access @${cleanUsername} - unknown page state`);
      }
    }
    
    // Try to wait for tweet content with multiple strategies
    console.log(`⏳ [${scrapeId}] Waiting for tweet content to load...`);
    
    let tweetsFound = false;
    const tweetSelectors = [
      'article[data-testid="tweet"]',
      'article',
      '[data-testid="tweetText"]',
      'div[data-testid="primaryColumn"] article'
    ];
    
    // Try each selector with reasonable timeout
    for (const selector of tweetSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 8000 });
        tweetsFound = true;
        console.log(`✅ [${scrapeId}] Found content with selector: ${selector}`);
        break;
      } catch (e) {
        console.log(`⏳ [${scrapeId}] Selector ${selector} failed, trying next...`);
        continue;
      }
    }
    
    // If no tweets found but we have a valid profile, continue anyway
    if (!tweetsFound) {
      console.log(`📭 [${scrapeId}] No tweet elements found, but profile is valid`);
    }

    // Allow more time for dynamic content
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
            if (textElement && textElement.innerText && textElement.innerText.trim().length > 3) {
              tweetText = textElement.innerText.trim();
              break;
            }
          }
          
          // Skip if no meaningful text content and no media
          const hasMedia = article.querySelector('img[src*="pbs.twimg.com"]') || 
                           article.querySelector('video') ||
                           article.querySelector('[data-testid="gif"]');
          
          if (!tweetText && !hasMedia) continue;
          if (tweetText && tweetText.length < 3) continue;

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

          if (!timestamp) {
            timestamp = new Date().toISOString(); // Fallback timestamp
          }
          
          const tweetDate = new Date(timestamp);
          if (isNaN(tweetDate.getTime()) || tweetDate < cutoffDate) continue;

          // Extract display name
          let displayName = username;
          const nameElement = article.querySelector('[data-testid="User-Names"] span:first-child') ||
                            article.querySelector('[data-testid="User-Name"] span') ||
                            article.querySelector('[data-testid="UserName"] span');
          
          if (nameElement && nameElement.textContent && nameElement.textContent.trim()) {
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
      success: tweets.length > 0,
      username: cleanUsername,
      tweets,
      count: tweets.length,
      requested: maxTweets,
      performance: {
        scrape_time_ms: totalTime,
        instance_id: browserManager.instanceId
      },
      scraped_at: new Date().toISOString(),
      analysis: pageAnalysis, // Include debug info
      ...(tweets.length === 0 ? {
        warning: 'No recent tweets found within the specified timeframe',
        suggestions: [
          'Try increasing freshnessDays parameter',
          'Account may have no recent activity',
          'Try again in a few minutes if rate limited'
        ]
      } : {})
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
      scraped_at: new Date().toISOString(),
      suggestions: [
        'Check if Twitter cookies are properly configured',
        'Try again in a few minutes if rate limited',
        'Verify the username is correct'
      ]
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
    status: 'Enhanced Single Account Twitter Scraper v2.1',
    version: '2.1.0',
    chrome_executable: chromePath || 'default',
    browser_stats: stats,
    cookies_configured: !!process.env.TWITTER_COOKIES,
    timestamp: new Date().toISOString(),
    features: [
      'Precise Error Detection',
      'Debug Analysis',
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
  
  // Always return 200 for successful requests, let client decide based on success field
  res.json(result);
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
  
  res.json(result);
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

// Debug endpoint to check what page content we're actually getting
app.post('/debug-page', async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const scrapeId = crypto.randomBytes(6).toString('hex');
  const cleanUsername = username.replace('@', '');
  
  let page;
  try {
    page = await browserManager.createOptimizedPage(scrapeId);
    
    const profileURL = `https://x.com/${cleanUsername}`;
    console.log(`🔍 [DEBUG-${scrapeId}] Navigating to ${profileURL}`);
    
    await page.goto(profileURL, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get comprehensive page debug info
    const debugInfo = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        bodyText: document.body.innerText.substring(0, 1000),
        selectors: {
          articles: document.querySelectorAll('article').length,
          tweetText: document.querySelectorAll('[data-testid="tweetText"]').length,
          userNames: document.querySelectorAll('[data-testid="User-Names"]').length,
          userName: document.querySelectorAll('[data-testid="UserName"]').length
        },
        firstArticleContent: (() => {
          const firstArticle = document.querySelector('article');
          return firstArticle ? firstArticle.innerText.substring(0, 200) : 'No articles found';
        })(),
        pageStructure: {
          hasMainContent: !!document.querySelector('main'),
          hasPrimaryColumn: !!document.querySelector('[data-testid="primaryColumn"]'),
          hasUserProfile: !!document.querySelector('[data-testid="User-Names"]'),
          hasLoginElements: !!document.querySelector('[data-testid="loginButton"]')
        }
      };
    });
    
    res.json({
      success: true,
      username: cleanUsername,
      debug_info: debugInfo,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.json({
      success: false,
      username: cleanUsername,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    if (page) {
      await browserManager.closePage(page, scrapeId);
    }
  }
});

// Initialize browser and start server
async function startServer() {
  try {
    console.log('🔥 Initializing Twitter scraper browser...');
    await browserManager.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Enhanced Single Account Twitter Scraper v2.1 running on port ${PORT}`);
      console.log(`🔍 Chrome: ${browserManager.findChrome() || 'default'}`);
      console.log(`🍪 Cookies: ${!!process.env.TWITTER_COOKIES ? 'configured' : 'not configured'}`);
      console.log(`🔥 Browser ready with ID: ${browserManager.instanceId}`);
      
      console.log(`\n📡 Available Endpoints:`);
      console.log(`  GET  /              - Health check & status`);
      console.log(`  GET  /stats         - Detailed server stats`);
      console.log(`  POST /scrape        - Scrape by username`);
      console.log(`  POST /scrape-url    - Scrape by profile URL`);
      console.log(`  POST /debug-page    - Debug page content`);
      console.log(`  POST /restart-browser - Restart browser`);
      
      console.log(`\n📝 Usage Examples:`);
      console.log(`  POST /scrape`);
      console.log(`  {`);
      console.log(`    "username": "elonmusk",`);
      console.log(`    "maxTweets": 10,`);
      console.log(`    "freshnessDays": 7`);
      console.log(`  }`);
      
      console.log(`\n  POST /debug-page`);
      console.log(`  {`);
      console.log(`    "username": "elonmusk"`);
      console.log(`  }`);
      
      console.log(`\n🔧 Key Improvements in v2.1:`);
      console.log(`  ✅ Completely rewritten error detection`);
      console.log(`  ✅ Added comprehensive page analysis`);
      console.log(`  ✅ Added debug endpoint for troubleshooting`);
      console.log(`  ✅ More precise suspension/rate limit detection`);
      console.log(`  ✅ Better fallback handling for edge cases`);
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
