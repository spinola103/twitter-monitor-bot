const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 🔥 ENHANCED BROWSER POOL MANAGEMENT
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
          '--lang=en-US',
          '--disable-extensions-file-access-check',
          '--disable-extensions-except',
          '--disable-plugins-discovery'
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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);
    
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    });

    // Enhanced anti-detection scripts
    await page.evaluateOnNewDocument(() => {
      try {
        // Clear storage
        localStorage.clear();
        sessionStorage.clear();
        
        // Remove webdriver traces
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        
        // Mock chrome object
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
        };
        
        // Mock languages and plugins
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Mock permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
        );

        // Hide automation traces
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        
      } catch (e) {
        console.log('Anti-detection setup error:', e);
      }
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
    status: 'Twitter Recent Tweet Scraper - LATEST TWEETS FIRST', 
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

// 🎯 COMPLETELY REWRITTEN - FORCE FRESH TWEET LOADING
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
    
    // FORCE FRESH CONTENT - Add cache busting and refresh parameters
    const freshURL = searchURL + (searchURL.includes('?') ? '&' : '?') + 
                     `_t=${Date.now()}&src=typed_query&f=live`;
    
    console.log('🔄 Using fresh URL:', freshURL);
    
    // Enhanced navigation with retries
    let navSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 Navigation attempt ${attempt}...`);
        
        // Clear any existing content first
        if (attempt > 1) {
          await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          });
        }
        
        const response = await page.goto(freshURL, { 
          waitUntil: 'networkidle0',
          timeout: 45000
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
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    if (!navSuccess) {
      throw new Error('Failed to navigate after 3 attempts');
    }

    // FORCE FRESH CONTENT LOADING
    console.log('🔄 Forcing fresh content reload...');
    
    // Wait for initial content
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Force refresh by scrolling up first (to trigger fresh content load)
    await page.evaluate(() => {
      window.scrollTo(0, -1000); // Scroll up beyond top
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await page.evaluate(() => {
      window.scrollTo(0, 0); // Back to absolute top
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Trigger a "pull to refresh" like behavior
    await page.keyboard.press('Home'); // Go to very top
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check for loading indicators and wait for them to disappear
    console.log('⏳ Waiting for content loading indicators...');
    
    try {
      // Wait for spinner or loading indicators to appear and disappear
      await page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 15000 });
      
      // Wait for actual tweet content to load
      const contentSelectors = [
        '[data-testid="cellInnerDiv"]',
        'article[data-testid="tweet"]',
        '[data-testid="tweetText"]'
      ];
      
      let contentFound = false;
      for (const selector of contentSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          console.log(`✅ Content detected with selector: ${selector}`);
          contentFound = true;
          break;
        } catch (e) {
          console.log(`⏳ Trying next content selector: ${selector}`);
        }
      }
      
    } catch (e) {
      console.log('⚠️ Standard content detection failed, proceeding with alternative approach...');
    }

    // AGGRESSIVE FRESH CONTENT LOADING STRATEGY
    console.log('🔄 Implementing aggressive fresh content loading...');
    
    let totalTweetsFound = 0;
    let freshContentLoaded = false;
    
    // Multiple loading attempts with different strategies
    for (let loadingCycle = 0; loadingCycle < 3; loadingCycle++) {
      console.log(`🔄 Loading cycle ${loadingCycle + 1}/3`);
      
      // Strategy 1: Rapid small scrolls from top
      if (loadingCycle === 0) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        for (let i = 0; i < 10; i++) {
          await page.evaluate(() => {
            window.scrollBy(0, 200);
          });
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check tweet count periodically
          if (i % 3 === 0) {
            const currentCount = await page.evaluate(() => {
              return document.querySelectorAll('[data-testid="cellInnerDiv"]').length;
            });
            console.log(`📊 Cycle ${loadingCycle + 1}, scroll ${i + 1}: ${currentCount} containers`);
            if (currentCount > totalTweetsFound) {
              totalTweetsFound = currentCount;
              freshContentLoaded = true;
            }
          }
        }
      }
      
      // Strategy 2: Medium scrolls with pauses
      else if (loadingCycle === 1) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        for (let i = 0; i < 8; i++) {
          await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight * 0.6);
          });
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          const currentCount = await page.evaluate(() => {
            return document.querySelectorAll('[data-testid="cellInnerDiv"]').length;
          });
          console.log(`📊 Cycle ${loadingCycle + 1}, scroll ${i + 1}: ${currentCount} containers`);
          if (currentCount > totalTweetsFound) {
            totalTweetsFound = currentCount;
          }
        }
      }
      
      // Strategy 3: Force page refresh and reload
      else {
        console.log('🔄 Final attempt: Force page refresh...');
        await page.reload({ waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Quick content check
        const currentCount = await page.evaluate(() => {
          return document.querySelectorAll('[data-testid="cellInnerDiv"]').length;
        });
        console.log(`📊 After refresh: ${currentCount} containers`);
        totalTweetsFound = Math.max(totalTweetsFound, currentCount);
      }
      
      // Break if we have sufficient tweets
      if (totalTweetsFound >= maxTweets * 2) {
        console.log('✅ Sufficient content loaded, proceeding to extraction');
        break;
      }
    }
    
    // Final position at top for extraction
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`📊 Final content check: ${totalTweetsFound} total containers found`);

    // 🎯 ENHANCED TWEET EXTRACTION - PRIORITIZE RECENT TIMESTAMPS
    console.log('🎯 Extracting tweets with timestamp priority...');
    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const now = new Date();
      const currentYear = now.getFullYear();
      
      // Helper to convert relative time to actual date
      const parseTimeToDate = (timeText, datetime = null) => {
        if (datetime) {
          return new Date(datetime);
        }
        
        const text = timeText.toLowerCase().trim();
        const now = new Date();
        
        // Handle "now", "just now"
        if (text.includes('now')) {
          return now;
        }
        
        // Handle relative times like "1h", "30m", "2d"
        const timeMatch = text.match(/(\d+)([smhd])/);
        if (timeMatch) {
          const value = parseInt(timeMatch[1]);
          const unit = timeMatch[2];
          const milliseconds = {
            's': value * 1000,
            'm': value * 60 * 1000,
            'h': value * 60 * 60 * 1000,
            'd': value * 24 * 60 * 60 * 1000
          }[unit];
          
          if (milliseconds) {
            return new Date(now.getTime() - milliseconds);
          }
        }
        
        // Handle formatted dates like "Dec 5", "Mar 15"
        const monthMatch = text.match(/([a-z]{3})\s+(\d+)/i);
        if (monthMatch) {
          const months = {
            jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
            jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
          };
          const month = months[monthMatch[1].toLowerCase()];
          const day = parseInt(monthMatch[2]);
          if (month !== undefined) {
            const date = new Date(currentYear, month, day);
            // If date is in future, assume it's from last year
            if (date > now) {
              date.setFullYear(currentYear - 1);
            }
            return date;
          }
        }
        
        return null;
      };

      // Get all containers and prioritize by DOM order (newest first usually)
      const containers = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
      console.log(`🔍 Processing ${containers.length} tweet containers`);
      
      const candidateTweets = [];
      
      for (let i = 0; i < containers.length; i++) {
        const container = containers[i];
        
        try {
          // Skip promoted content
          if (container.querySelector('[data-testid="placementTracking"]') ||
              container.querySelector('[aria-label*="Promoted"]') ||
              container.innerText.includes('Promoted') ||
              container.innerText.includes('Ad ·')) {
            continue;
          }

          // Skip pinned tweets (usually older)
          const socialContext = container.querySelector('[data-testid="socialContext"]');
          if (socialContext?.innerText?.includes('Pinned')) {
            continue;
          }

          const article = container.querySelector('article[data-testid="tweet"]') || container;
          if (!article) continue;

          // Extract tweet ID and link
          const linkElement = article.querySelector('a[href*="/status/"]');
          if (!linkElement) continue;
          
          const href = linkElement.getAttribute('href');
          const link = href.startsWith('http') ? href : 'https://x.com' + href;
          const tweetIdMatch = href.match(/status\/(\d+)/);
          if (!tweetIdMatch) continue;
          
          const tweetId = tweetIdMatch[1];

          // Extract timestamp - this is crucial for recent tweets
          let timestamp = null;
          let relativeTime = '';
          let parsedDate = null;
          
          const timeElements = article.querySelectorAll('time');
          for (const timeEl of timeElements) {
            const datetime = timeEl.getAttribute('datetime');
            const innerText = timeEl.textContent?.trim();
            
            if (datetime) {
              timestamp = datetime;
              parsedDate = new Date(datetime);
              relativeTime = innerText || '';
              break;
            } else if (innerText) {
              parsedDate = parseTimeToDate(innerText);
              if (parsedDate) {
                timestamp = parsedDate.toISOString();
                relativeTime = innerText;
                break;
              }
            }
          }

          if (!timestamp || !parsedDate) {
            console.log(`No valid timestamp for tweet ${i}, skipping`);
            continue;
          }

          // Extract tweet text
          let text = '';
          const textSelectors = [
            '[data-testid="tweetText"]',
            '[data-testid="tweetText"] span',
            'div[lang]:not([data-testid])',
            'div[dir="auto"][lang]'
          ];
          
          for (const selector of textSelectors) {
            const textEl = article.querySelector(selector);
            if (textEl && textEl.textContent?.trim()) {
              text = textEl.textContent.trim();
              break;
            }
          }

          // Check for media
          const hasMedia = !!(article.querySelector('img[alt]:not([alt=""])') || 
                             article.querySelector('video') ||
                             article.querySelector('[data-testid="videoPlayer"]'));

          if (!text && !hasMedia) continue;

          // Extract user info
          let username = '';
          let displayName = '';
          
          const userLinks = article.querySelectorAll('a[href^="/"]');
          for (const link of userLinks) {
            const userHref = link.getAttribute('href');
            if (userHref && userHref.match(/^\/\w+$/) && !userHref.includes('/status/')) {
              username = userHref.substring(1);
              break;
            }
          }
          
          const nameElements = article.querySelectorAll('[data-testid*="User"] span');
          for (const nameEl of nameElements) {
            const nameText = nameEl.textContent?.trim();
            if (nameText && !nameText.startsWith('@') && !nameText.includes('·')) {
              displayName = nameText;
              break;
            }
          }

          // Calculate age in hours for prioritization
          const ageInHours = (now - parsedDate) / (1000 * 60 * 60);
          
          candidateTweets.push({
            id: tweetId,
            username: username,
            displayName: displayName,
            text: text,
            link: link,
            timestamp: timestamp,
            relativeTime: relativeTime,
            parsedDate: parsedDate,
            ageInHours: ageInHours,
            hasMedia: hasMedia,
            domPosition: i, // Original DOM position
            scraped_at: new Date().toISOString()
          });

        } catch (e) {
          console.error(`Error processing container ${i}:`, e.message);
        }
      }

      // Sort by recency (newest first) and take the most recent ones
      const sortedTweets = candidateTweets
        .sort((a, b) => a.parsedDate - b.parsedDate) // Oldest first
        .reverse() // Now newest first
        .slice(0, maxTweets);

      console.log(`📊 Found ${candidateTweets.length} candidate tweets, returning ${sortedTweets.length} newest`);
      
      // Add engagement metrics to final tweets
      for (const tweet of sortedTweets) {
        // Find the container again for engagement metrics
        const container = containers.find(c => 
          c.querySelector(`a[href*="${tweet.id}"]`)
        );
        
        if (container) {
          const getMetric = (type) => {
            const selectors = {
              likes: ['[data-testid="like"]', '[data-testid="favorite"]'],
              retweets: ['[data-testid="retweet"]'],
              replies: ['[data-testid="reply"]']
            }[type] || [];
            
            for (const selector of selectors) {
              const el = container.querySelector(selector);
              if (el) {
                const text = el.textContent?.trim();
                if (text && !isNaN(parseInt(text))) {
                  return parseInt(text);
                }
                // Check aria-label for metrics
                const label = el.getAttribute('aria-label') || '';
                const match = label.match(/(\d+)/);
                if (match) {
                  return parseInt(match[1]);
                }
              }
            }
            return 0;
          };
          
          tweet.likes = getMetric('likes');
          tweet.retweets = getMetric('retweets');
          tweet.replies = getMetric('replies');
        } else {
          tweet.likes = 0;
          tweet.retweets = 0;
          tweet.replies = 0;
        }
        
        // Calculate freshness score
        if (tweet.ageInHours <= 1) tweet.freshness_score = 100;
        else if (tweet.ageInHours <= 6) tweet.freshness_score = 90;
        else if (tweet.ageInHours <= 24) tweet.freshness_score = 80;
        else if (tweet.ageInHours <= 72) tweet.freshness_score = 60;
        else tweet.freshness_score = 20;
      }

      return sortedTweets;
    }, maxTweets);

    // Filter and prepare final response
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const recentTweets = tweets.filter(tweet => new Date(tweet.timestamp) > oneDayAgo);
    const weeklyTweets = tweets.filter(tweet => new Date(tweet.timestamp) > oneWeekAgo);
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 EXTRACTION COMPLETE:`);
    console.log(`   📊 Total tweets: ${tweets.length}`);
    console.log(`   🔥 Recent (24h): ${recentTweets.length}`);
    console.log(`   📅 This week: ${weeklyTweets.length}`);
    console.log(`   ⏱️  Time taken: ${totalTime}ms`);

    res.json({
      success: true,
      count: tweets.length,
      recent_count: recentTweets.length,
      weekly_count: weeklyTweets.length,
      requested: maxTweets,
      tweets: tweets,
      scraped_at: new Date().toISOString(),
      profile_url: searchURL,
      performance: {
        total_time_ms: totalTime,
        browser_reused: true,
        fresh_content_forced: true,
        loading_cycles_used: 3
      },
      browser_pool: browserPool.getStats(),
      extraction_stats: {
        total_containers_found: totalTweetsFound,
        avg_freshness_score: tweets.length > 0 ? 
          Math.round(tweets.reduce((sum, tweet) => sum + tweet.freshness_score, 0) / tweets.length) : 0,
        containers_processed: tweets.length,
        skipped_promoted: 0, // Could be tracked if needed
        skipped_pinned: 0,   // Could be tracked if needed
        timestamp_parse_success_rate: tweets.length > 0 ? 
          Math.round((tweets.filter(t => t.timestamp).length / tweets.length) * 100) : 0
      }
    });

  } catch (error) {
    console.error('💥 Scraping failed:', error.message);
    
    const totalTime = Date.now() - startTime;
    
    res.status(500).json({
      success: false,
      error: error.message,
      scraped_at: new Date().toISOString(),
      profile_url: searchURL,
      performance: {
        total_time_ms: totalTime,
        browser_reused: !!browserPool.browser,
        error_occurred: true
      },
      browser_pool: browserPool.getStats()
    });
    
  } finally {
    if (page) {
      await browserPool.releasePage(page);
    }
  }
});

// 🚀 NEW ENDPOINT: Get latest tweets with enhanced freshness detection
app.post('/scrape-latest', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = req.body.maxTweets || 10;
  const maxAgeHours = req.body.maxAgeHours || 24; // Only tweets from last N hours
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  let page;
  const startTime = Date.now();
  
  try {
    page = await browserPool.getPage();
    console.log(`⚡ Got page from pool for latest tweets in ${Date.now() - startTime}ms`);
    
    // Force the latest/live view
    const liveURL = searchURL.includes('/search?') 
      ? searchURL.replace('&f=top', '&f=live').replace('&f=user', '&f=live')
      : searchURL + (searchURL.includes('?') ? '&f=live' : '?f=live');
    
    const freshURL = liveURL + `&t=${Date.now()}`;
    console.log('🔴 LIVE MODE: Using URL:', freshURL);
    
    // Navigate with extra aggressive caching disabled
    await page.goto(freshURL, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait for content and immediately start extraction
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Rapid extraction focusing on very recent content
    const tweets = await page.evaluate((maxTweets, maxAgeHours) => {
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - (maxAgeHours * 60 * 60 * 1000));
      
      const containers = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
      console.log(`🔍 LATEST MODE: Processing ${containers.length} containers for tweets newer than ${maxAgeHours}h`);
      
      const recentTweets = [];
      
      for (const container of containers.slice(0, maxTweets * 3)) { // Check more containers
        try {
          const article = container.querySelector('article[data-testid="tweet"]');
          if (!article) continue;
          
          // Quick timestamp check
          const timeEl = article.querySelector('time');
          if (!timeEl) continue;
          
          const datetime = timeEl.getAttribute('datetime');
          const relativeText = timeEl.textContent?.trim() || '';
          
          let tweetDate = null;
          
          if (datetime) {
            tweetDate = new Date(datetime);
          } else {
            // Parse relative time more aggressively
            const text = relativeText.toLowerCase();
            if (text.includes('now') || text.includes('s')) {
              tweetDate = now;
            } else if (text.includes('m')) {
              const mins = parseInt(text.match(/(\d+)/)?.[1] || '0');
              tweetDate = new Date(now.getTime() - mins * 60 * 1000);
            } else if (text.includes('h')) {
              const hours = parseInt(text.match(/(\d+)/)?.[1] || '0');
              tweetDate = new Date(now.getTime() - hours * 60 * 60 * 1000);
            }
          }
          
          // Skip if too old
          if (!tweetDate || tweetDate < cutoffTime) {
            continue;
          }
          
          // Quick data extraction
          const linkEl = article.querySelector('a[href*="/status/"]');
          if (!linkEl) continue;
          
          const href = linkEl.getAttribute('href');
          const tweetId = href.match(/status\/(\d+)/)?.[1];
          if (!tweetId) continue;
          
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const text = textEl?.textContent?.trim() || '';
          
          const userLink = article.querySelector('a[href^="/"][href*="/status/"]:not([href*="/status/"])') ||
                          article.querySelector('a[href^="/"]');
          const username = userLink?.getAttribute('href')?.substring(1)?.split('/')[0] || '';
          
          recentTweets.push({
            id: tweetId,
            username: username,
            text: text,
            link: href.startsWith('http') ? href : 'https://x.com' + href,
            timestamp: tweetDate.toISOString(),
            relativeTime: relativeText,
            ageInHours: (now - tweetDate) / (1000 * 60 * 60),
            freshness_score: tweetDate > new Date(now.getTime() - 60*60*1000) ? 100 : 80,
            scraped_at: now.toISOString()
          });
          
          if (recentTweets.length >= maxTweets) break;
          
        } catch (e) {
          console.error('Container processing error:', e);
        }
      }
      
      // Sort by recency
      return recentTweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
    }, maxTweets, maxAgeHours);
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🔴 LATEST MODE COMPLETE: ${tweets.length} tweets from last ${maxAgeHours}h in ${totalTime}ms`);
    
    res.json({
      success: true,
      mode: 'latest',
      count: tweets.length,
      max_age_hours: maxAgeHours,
      requested: maxTweets,
      tweets: tweets,
      scraped_at: new Date().toISOString(),
      profile_url: searchURL,
      performance: {
        total_time_ms: totalTime,
        speed_optimized: true,
        live_mode: true
      }
    });
    
  } catch (error) {
    console.error('💥 Latest scraping failed:', error.message);
    res.status(500).json({
      success: false,
      mode: 'latest',
      error: error.message,
      scraped_at: new Date().toISOString()
    });
  } finally {
    if (page) {
      await browserPool.releasePage(page);
    }
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const stats = browserPool.getStats();
    const health = {
      status: 'healthy',
      browser_pool: stats,
      memory_usage: process.memoryUsage(),
      uptime_seconds: process.uptime(),
      timestamp: new Date().toISOString()
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Twitter Scraper Server running on port ${PORT}`);
  console.log('📋 Available endpoints:');
  console.log('   GET  / - Server status');
  console.log('   POST /scrape - Full scraping (comprehensive)');
  console.log('   POST /scrape-latest - Latest tweets only (fast)');
  console.log('   POST /restart-browser - Restart browser pool');
  console.log('   GET  /health - Health check');
  console.log('💡 For latest tweets, use /scrape-latest endpoint');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  
  try {
    if (browserPool.browser) {
      await browserPool.browser.close();
      console.log('✅ Browser closed');
    }
  } catch (e) {
    console.error('❌ Error during shutdown:', e.message);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  
  try {
    if (browserPool.browser) {
      await browserPool.browser.close();
      console.log('✅ Browser closed');
    }
  } catch (e) {
    console.error('❌ Error during shutdown:', e.message);
  }
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  // Don't exit immediately, let the app try to recover
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit immediately, let the app try to recover
});
