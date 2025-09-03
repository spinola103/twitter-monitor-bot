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

    // Load and validate cookies
    if (!this.cookiesLoaded && process.env.TWITTER_COOKIES) {
      await this.loadCookies(page);
    }

    console.log(`📄 Created new page (${this.pages.size}/${this.maxPages} active)`);
    return page;
  }

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
        cookie.name && cookie.value && cookie.domain
      );
      
      if (validCookies.length === 0) {
        this.cookieValidation = { isValid: false, message: 'No valid cookies found (need name, value, domain)' };
        return false;
      }

      // Check for essential Twitter cookies
      const essentialCookieNames = ['auth_token', 'ct0', 'twid'];
      const foundEssential = essentialCookieNames.some(name => 
        validCookies.find(cookie => cookie.name === name)
      );

      if (!foundEssential) {
        this.cookieValidation = { 
          isValid: false, 
          message: `Missing essential cookies. Found: ${validCookies.map(c => c.name).join(', ')}. Need: ${essentialCookieNames.join(', ')}` 
        };
        console.log('⚠️ Essential Twitter cookies missing');
      }
      
      await page.setCookie(...validCookies);
      this.cookiesLoaded = true;
      this.cookieValidation = { 
        isValid: foundEssential, 
        message: foundEssential ? `Successfully loaded ${validCookies.length} cookies` : 'Cookies loaded but may be incomplete'
      };
      console.log(`✅ ${validCookies.length} cookies loaded to browser pool`);
      
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

// Function to find Chrome executable
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

// Health check endpoint with browser stats
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

// Manual browser restart endpoint
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

// IMPROVED SCRAPE ENDPOINT
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
    
    // Navigate with improved error handling
    try {
      const response = await page.goto(searchURL, { 
        waitUntil: 'networkidle0',
        timeout: 60000
      });
      
      console.log('✅ Navigation completed, status:', response?.status());
      
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
        throw new Error('❌ Redirected to login page - Check your cookies configuration');
      }
      
    } catch (navError) {
      console.log(`❌ Navigation failed:`, navError.message);
      
      console.log('🔄 Trying fallback navigation...');
      await page.goto(searchURL, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    }

    // Enhanced content waiting strategy
    console.log('⏳ Waiting for tweets to load...');
    
    const selectors = [
      'article[data-testid="tweet"]',
      '[data-testid="tweet"]',
      'article[role="article"]',
      'div[data-testid="tweetText"]',
      'article',
      '[data-testid="cellInnerDiv"]'
    ];
    
    let contentFound = false;
    let finalSelector = null;
    
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        const elementCount = await page.$$eval(selector, els => els.length);
        console.log(`✅ Found ${elementCount} elements with selector: ${selector}`);
        if (elementCount > 0) {
          contentFound = true;
          finalSelector = selector;
          break;
        }
      } catch (e) {
        console.log(`⏳ Selector ${selector} not found, trying next...`);
      }
    }
    
    if (!contentFound) {
      // Check page content for specific errors
      const pageContent = await page.content();
      const currentUrl = page.url();
      
      if (pageContent.includes('Log in to Twitter') || 
          pageContent.includes('Sign up for Twitter') ||
          pageContent.includes('Sign in to X') ||
          currentUrl.includes('/login')) {
        throw new Error(`❌ Authentication required. Cookie status: ${browserPool.cookieValidation.message}`);
      }
      
      if (pageContent.includes('rate limit') || pageContent.includes('Rate limit')) {
        throw new Error('❌ Rate limited by Twitter - Please try again later');
      }
      
      if (pageContent.includes('suspended') || pageContent.includes('Account suspended')) {
        throw new Error('❌ Target account is suspended');
      }
      
      if (pageContent.includes('protected') || pageContent.includes('These Tweets are protected')) {
        throw new Error('❌ Target account is protected/private');
      }
      
      console.log('🔍 Page title:', await page.title());
      console.log('🔍 Current URL:', currentUrl);
      throw new Error(`❌ No tweet content found. Page may have loaded incorrectly.`);
    }

    // Wait for content to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Improved scrolling strategy
    console.log('📍 Scrolling to load fresh content...');
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Smart scrolling to load more tweets
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check if we have enough tweets
      const tweetCount = await page.$$eval('article', articles => articles.length);
      console.log(`🔄 Scroll ${i + 1}: Found ${tweetCount} articles`);
      if (tweetCount >= maxTweets * 2) break;
    }
    
    // Return to top for extraction
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ENHANCED TWEET EXTRACTION
    console.log('🎯 Extracting tweets...');
    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const articles = document.querySelectorAll('article');
      console.log(`Found ${articles.length} total articles to process`);

      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];
        try {
          // Skip promoted content
          if (article.querySelector('[data-testid="promotedIndicator"]') || 
              article.innerText.toLowerCase().includes('promoted')) {
            console.log(`Skipping promoted content at index ${i}`);
            continue;
          }

          // Better pinned tweet detection
          const pinnedIndicators = [
            '[aria-label*="Pinned"]',
            '[data-testid="socialContext"]',
            'svg[aria-label*="Pinned"]',
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
          const articleText = article.innerText.toLowerCase();
          if (articleText.includes('pinned tweet') || 
              articleText.includes('📌') ||
              (articleText.includes('pinned') && i < 3)) {
            isPinned = true;
          }
          
          if (isPinned) {
            console.log(`Skipping pinned tweet at index ${i}`);
            continue;
          }

          // Extract tweet text - try multiple selectors
          const textSelectors = [
            '[data-testid="tweetText"]',
            'div[lang]',
            '[data-testid="tweet"] div[dir="ltr"]',
            'span[dir="ltr"]'
          ];
          
          let text = '';
          for (const selector of textSelectors) {
            const textElement = article.querySelector(selector);
            if (textElement && textElement.innerText.trim()) {
              text = textElement.innerText.trim();
              break;
            }
          }

          // Skip if no meaningful text and no media
          if (!text && !article.querySelector('img, video')) {
            console.log(`Skipping article ${i} - no text or media`);
            continue;
          }

          // Extract tweet link and ID - improved detection
          const linkSelectors = [
            'a[href*="/status/"]',
            'time[datetime] + a',
            'a[href*="/tweet/"]',
            'a[role="link"][href*="/"]'
          ];
          
          let link = null;
          let tweetId = null;
          
          for (const selector of linkSelectors) {
            const linkElement = article.querySelector(selector);
            if (linkElement) {
              const href = linkElement.getAttribute('href');
              if (href && href.includes('/status/')) {
                link = href.startsWith('http') ? href : 'https://twitter.com' + href;
                const match = href.match(/status\/(\d+)/);
                if (match) {
                  tweetId = match[1];
                  break;
                }
              }
            }
          }
          
          if (!link || !tweetId) {
            console.log(`Skipping article ${i} - no valid tweet link found`);
            continue;
          }

          // Enhanced timestamp extraction
          const timeElement = article.querySelector('time[datetime]');
          let timestamp = null;
          let relativeTime = '';
          
          if (timeElement) {
            timestamp = timeElement.getAttribute('datetime');
            relativeTime = timeElement.innerText.trim();
            
            // Convert relative time to absolute if datetime is missing
            if (!timestamp && relativeTime) {
              const now = new Date();
              if (relativeTime.includes('s') || relativeTime === 'now') {
                timestamp = now.toISOString();
              } else if (relativeTime.includes('m')) {
                const mins = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
                timestamp = new Date(now.getTime() - mins * 60000).toISOString();
              } else if (relativeTime.includes('h')) {
                const hours = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
                timestamp = new Date(now.getTime() - hours * 3600000).toISOString();
              } else if (relativeTime.match(/\d+[dD]/)) {
                const days = parseInt(relativeTime.match(/\d+/)?.[0]) || 1;
                timestamp = new Date(now.getTime() - days * 86400000).toISOString();
              }
            }
          }
          
          if (!timestamp) {
            console.log(`Skipping article ${i} - no valid timestamp`);
            continue;
          }

          // Improved user info extraction
          let username = '';
          let displayName = '';
          
          // Try multiple approaches for user info
          const userLinkElement = article.querySelector('a[href^="/"][href*="/"]');
          if (userLinkElement) {
            const userHref = userLinkElement.getAttribute('href');
            if (userHref && userHref !== '/' && !userHref.includes('/status/')) {
              username = userHref.replace('/', '').split('/')[0];
            }
          }
          
          const displayNameElement = article.querySelector('[data-testid="User-Name"] span, [data-testid="User-Names"] span');
          if (displayNameElement) {
            displayName = displayNameElement.textContent.trim();
          }

          // Enhanced metrics extraction
          const getMetric = (testId, fallbackSelectors = []) => {
            let element = article.querySelector(`[data-testid="${testId}"]`);
            
            // Try fallback selectors if main one fails
            if (!element) {
              for (const selector of fallbackSelectors) {
                element = article.querySelector(selector);
                if (element) break;
              }
            }
            
            if (!element) return 0;
            
            const ariaLabel = element.getAttribute('aria-label') || '';
            const textContent = element.textContent || '';
            
            // Extract number from aria-label or text
            const combinedText = (ariaLabel + ' ' + textContent).toLowerCase();
            const numberMatch = combinedText.match(/(\d+(?:[,\s]\d+)*)/);
            
            if (numberMatch) {
              return parseInt(numberMatch[1].replace(/[,\s]/g, ''));
            }
            
            return 0;
          };

          const tweet = {
            id: tweetId,
            username: username.replace(/^@/, ''),
            displayName: displayName,
            text,
            link,
            likes: getMetric('like', ['[aria-label*="like"]']),
            retweets: getMetric('retweet', ['[aria-label*="repost"]', '[aria-label*="retweet"]']),
            replies: getMetric('reply', ['[aria-label*="repl"]']),
            timestamp,
            relativeTime,
            scraped_at: new Date().toISOString()
          };

          console.log(`✅ Extracted tweet ${tweetData.length + 1}: ${tweet.id} by @${tweet.username}`);
          tweetData.push(tweet);

        } catch (e) {
          console.error(`Error processing article ${i}:`, e.message);
        }
      }

      return tweetData;
    }, maxTweets);

    // Sort by timestamp (newest first) and apply minimal filtering
    tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Only filter out very old tweets (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const finalTweets = tweets
      .filter(t => {
        const tweetDate = new Date(t.timestamp);
        return tweetDate > thirtyDaysAgo;
      })
      .slice(0, maxTweets);
    
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
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Twitter Scraper API running on port ${PORT}`);
      console.log(`🔍 Chrome executable:`, findChrome() || 'default');
      console.log(`🍪 Cookies configured:`, !!process.env.TWITTER_COOKIES);
      if (process.env.TWITTER_COOKIES) {
        console.log(`🍪 Cookie validation:`, browserPool.cookieValidation.message);
      }
      console.log(`🔥 Browser pool ready - optimized for 24/7 operation!`);
      console.log(`⚡ Performance: ~10x faster requests with browser reuse`);
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
