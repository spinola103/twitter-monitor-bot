const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

// Health check endpoint
app.get('/', (req, res) => {
  const chromePath = findChrome();
  const cookiesAvailable = !!process.env.TWITTER_COOKIES;
  res.json({ 
    status: 'Twitter Fresh Tweet Scraper - LATEST TWEETS ONLY', 
    chrome: chromePath || 'default',
    cookies_configured: cookiesAvailable,
    timestamp: new Date().toISOString() 
  });
});

// AGGRESSIVE FRESH TWEET SCRAPER
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = req.body.maxTweets || 10;
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  let browser;
  try {
    const chromePath = findChrome();
    
    // Better launch options for stability
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
        '--user-data-dir=/tmp/chrome-user-data-' + Date.now()
      ],
      defaultViewport: { width: 1366, height: 768 }
    };

    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }

    console.log('🚀 Launching browser...');
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // Disable cache
    await page.setCacheEnabled(false);
    
    // Clear storage
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
    });

    // Set headers
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1'
    });

    // Load cookies with better error handling
    let cookiesLoaded = false;
    console.log('🍪 Attempting to load cookies...');
    
    if (process.env.TWITTER_COOKIES) {
      try {
        let cookies;
        
        // Try to parse as JSON first
        if (process.env.TWITTER_COOKIES.trim().startsWith('[') || process.env.TWITTER_COOKIES.trim().startsWith('{')) {
          cookies = JSON.parse(process.env.TWITTER_COOKIES);
        } else {
          // If it's a string format, try to convert
          console.log('⚠️ TWITTER_COOKIES appears to be in string format, attempting conversion...');
          throw new Error('Invalid cookie format');
        }
        
        // Ensure it's an array
        if (!Array.isArray(cookies)) {
          if (typeof cookies === 'object' && cookies.name) {
            cookies = [cookies]; // Single cookie object
          } else {
            throw new Error('Cookies must be an array');
          }
        }
        
        if (cookies.length > 0) {
          // Validate cookie format
          const validCookies = cookies.filter(cookie => 
            cookie.name && cookie.value && cookie.domain
          );
          
          if (validCookies.length > 0) {
            await page.setCookie(...validCookies);
            cookiesLoaded = true;
            console.log(`✅ ${validCookies.length} valid cookies loaded successfully`);
          } else {
            console.log('❌ No valid cookies found in the provided data');
          }
        }
      } catch (err) {
        console.error('❌ Cookie loading failed:', err.message);
        console.log('💡 Expected format: [{"name":"cookie_name","value":"cookie_value","domain":".twitter.com"}]');
        console.log('💡 Current TWITTER_COOKIES preview:', process.env.TWITTER_COOKIES?.substring(0, 100) + '...');
      }
    } else {
      console.log('❌ TWITTER_COOKIES environment variable not set');
    }

    console.log('🌐 Navigating to:', searchURL);
    
    // Navigate with better error handling
    try {
      const response = await page.goto(searchURL, { 
        waitUntil: 'networkidle0',
        timeout: 60000
      });
      
      console.log('✅ Navigation completed, status:', response?.status());
      
      // Check if we're redirected to login
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
        throw new Error('❌ Redirected to login page - Authentication required');
      }
      
    } catch (navError) {
      console.log(`❌ Navigation failed:`, navError.message);
      
      // Try fallback navigation
      console.log('🔄 Trying fallback navigation...');
      await page.goto(searchURL, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    }

    // Wait for content with multiple strategies
    console.log('⏳ Waiting for tweets to load...');
    
    let tweetsFound = false;
    const selectors = [
      'article[data-testid="tweet"]',
      'article',
      '[data-testid="tweet"]',
      '[data-testid="tweetText"]'
    ];
    
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 15000 });
        console.log(`✅ Found content with selector: ${selector}`);
        tweetsFound = true;
        break;
      } catch (e) {
        console.log(`⏳ Trying next selector...`);
      }
    }
    
    if (!tweetsFound) {
      // Check what we actually got
      const pageContent = await page.content();
      const currentUrl = page.url();
      
      // Check for login requirement
      if (pageContent.includes('Log in to Twitter') || 
          pageContent.includes('Sign up for Twitter') ||
          pageContent.includes('login-prompt') ||
          currentUrl.includes('/login')) {
        throw new Error(`❌ Login required - Please check your TWITTER_COOKIES. Cookies loaded: ${cookiesLoaded}`);
      }
      
      // Check for rate limiting
      if (pageContent.includes('rate limit') || pageContent.includes('Rate limit')) {
        throw new Error('❌ Rate limited by Twitter - Please try again later');
      }
      
      // Check for suspended account
      if (pageContent.includes('suspended') || pageContent.includes('Account suspended')) {
        throw new Error('❌ Account appears to be suspended');
      }
      
      throw new Error(`❌ No tweets found - Account may be private or protected. Cookies loaded: ${cookiesLoaded}`);
    }

    // Wait a bit more for content to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Scroll to top
    console.log('📍 Scrolling to top for freshest content...');
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Light scrolling to load more tweets
    console.log('🔄 Loading more tweets...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Go back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract tweets with better error handling
    console.log('🎯 Extracting tweets...');
    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const articles = document.querySelectorAll('article');
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];
        try {
          // Skip promoted
          if (article.querySelector('[data-testid="promotedIndicator"]')) {
            continue;
          }

          // 🚫 Skip pinned tweets
          if (
            article.querySelector('[aria-label="Pinned"]') ||
            article.querySelector('[aria-label="Pinned Tweet"]') ||
            article.innerText.includes('Pinned') ||
            article.querySelector('[data-testid="socialContext"]')
          ) {
            continue;
          }

          // Tweet text (allow empty/emoji/media-only tweets)
          const textElement = article.querySelector('[data-testid="tweetText"]');
          const text = textElement ? textElement.innerText.trim() : '';

          if (!text && !article.querySelector('img')) continue;

          // Tweet link + ID
          const linkElement = article.querySelector('a[href*="/status/"]');
          if (!linkElement) continue;

          const href = linkElement.getAttribute('href');
          const link = href.startsWith('http') ? href : 'https://twitter.com' + href;
          const tweetId = link.match(/status\/(\d+)/)?.[1];
          if (!tweetId) continue;

          // Timestamp
          const timeElement = article.querySelector('time');
          let timestamp = timeElement ? timeElement.getAttribute('datetime') : null;
          const relativeTime = timeElement ? timeElement.innerText.trim() : '';

          if (!timestamp && relativeTime) {
            if (relativeTime.includes('s') || relativeTime.toLowerCase().includes('now')) {
              timestamp = new Date().toISOString();
            } else if (relativeTime.includes('m')) {
              const mins = parseInt(relativeTime) || 1;
              timestamp = new Date(now.getTime() - mins * 60000).toISOString();
            } else if (relativeTime.includes('h')) {
              const hours = parseInt(relativeTime) || 1;
              timestamp = new Date(now.getTime() - hours * 3600000).toISOString();
            } else if (relativeTime.includes('d')) {
              const days = parseInt(relativeTime) || 1;
              timestamp = new Date(now.getTime() - days * 86400000).toISOString();
            }
          }

          if (!timestamp) continue;
          const tweetDate = new Date(timestamp);
          if (isNaN(tweetDate.getTime()) || tweetDate < thirtyDaysAgo) continue;

          // User info
          const userElement = article.querySelector('[data-testid="User-Names"] a, [data-testid="User-Name"] a');
          let username = '';
          let displayName = '';

          if (userElement) {
            const userHref = userElement.getAttribute('href');
            username = userHref ? userHref.replace('/', '') : '';
          }

          const displayNameElement = article.querySelector('[data-testid="User-Names"] span, [data-testid="User-Name"] span');
          if (displayNameElement) {
            displayName = displayNameElement.textContent.trim();
          }

          // Metrics
          const getMetric = (testId) => {
            const element = article.querySelector(`[data-testid="${testId}"]`);
            if (!element) return 0;
            const text = element.getAttribute('aria-label') || element.textContent || '';
            const match = text.match(/(\d+(?:,\d+)*)/);
            return match ? parseInt(match[1].replace(/,/g, '')) : 0;
          };

          tweetData.push({
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
          });

        } catch (e) {
          console.error(`Error processing article ${i}:`, e.message);
        }
      }

      return tweetData;
    }, maxTweets);

    // Sort by timestamp (newest first)
    tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 🚫 Extra filter: drop pinned/old tweets
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 2); // ignore anything older than 2 days

    const finalTweets = tweets
      .filter(t => {
        // If pinned slipped through, it'll usually be much older than cutoff
        return new Date(t.timestamp) >= cutoff;
      })
      .slice(0, maxTweets);
    
    console.log(`🎉 SUCCESS: Extracted ${finalTweets.length} tweets!`);

    res.json({
      success: true,
      count: finalTweets.length,
      requested: maxTweets,
      tweets: finalTweets,
      scraped_at: new Date().toISOString(),
      profile_url: searchURL,
      cookies_loaded: cookiesLoaded,
      debug: {
        total_processed: tweets.length,
        cookies_working: cookiesLoaded
      }
    });

  } catch (error) {
    console.error('💥 SCRAPING FAILED:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString(),
      suggestion: error.message.includes('login') || error.message.includes('Authentication') ? 
        'Please provide valid Twitter cookies in TWITTER_COOKIES environment variable' :
        'Twitter might be rate limiting or blocking requests. Try again in a few minutes.'
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('🔒 Browser closed');
      } catch (e) {
        console.error('Error closing browser:', e.message);
      }
    }
  }
});

// Simplified user endpoint
app.post('/scrape-user', async (req, res) => {
  const username = req.body.username;
  const maxTweets = req.body.maxTweets || 10;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const cleanUsername = username.replace(/^@/, '');
  const profileURL = `https://x.com/${cleanUsername}`;
  
  console.log(`🎯 Scraping user: @${cleanUsername}`);
  
  // Forward to main endpoint
  req.body.url = profileURL;
  
  // Call the scrape endpoint internally
  const mockRes = {
    json: (data) => res.json(data),
    status: (code) => ({ json: (data) => res.status(code).json(data) })
  };
  
  return app._router.handle({ ...req, url: '/scrape', method: 'POST' }, mockRes);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Twitter Scraper API running on port ${PORT}`);
  console.log(`🔍 Chrome executable:`, findChrome() || 'default');
  console.log(`🍪 Cookies configured:`, !!process.env.TWITTER_COOKIES);
  console.log(`🔥 Ready to scrape fresh tweets!`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
