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
  res.json({ 
    status: 'Twitter Scraper API Ready', 
    chrome: chromePath || 'default',
    timestamp: new Date().toISOString() 
  });
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  const SCROLL_DELAY = parseInt(process.env.SCROLL_DELAY) || 2000;
  const MAX_SCROLL_ATTEMPTS = parseInt(process.env.MAX_SCROLL_ATTEMPTS) || 5;

  let browser;
  try {
    const chromePath = findChrome();
    
    // Launch browser with optimized settings for Railway
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // Important for Railway's memory limits
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--window-size=1200,800',
        '--memory-pressure-off'
      ],
      defaultViewport: { width: 1200, height: 800 }
    };

    // Add executablePath only if we found Chrome
    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    
    // Optimize page settings
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'stylesheet' || resourceType === 'image' || resourceType === 'font') {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    // Load cookies from environment variable
    try {
      if (process.env.TWITTER_COOKIES) {
        const cookies = JSON.parse(process.env.TWITTER_COOKIES);
        if (Array.isArray(cookies) && cookies.length > 0) {
          await page.setCookie(...cookies);
          console.log('🍪 Cookies loaded from environment');
        }
      }
    } catch (err) {
      console.error('❌ Failed to load cookies:', err.message);
    }

    console.log('🌐 Navigating to:', searchURL);
    await page.goto(searchURL, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 // Reduced timeout
    });

    // Wait for tweets to load
    try {
      await page.waitForSelector('article', { timeout: 15000 });
    } catch (e) {
      console.log('No articles found, checking for login requirement...');
      const loginRequired = await page.$('div[data-testid="login-prompt"]') || 
                            await page.$('a[href="/login"]') ||
                            await page.$('a[href="/i/flow/login"]');
      if (loginRequired) {
        throw new Error('Twitter login required - please provide valid cookies');
      }
      throw new Error('No tweets found on this page');
    }

    // Scroll to load more tweets
    let scrollAttempts = 0;
    let tweetCount = 0;
    
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
      const currentCount = await page.$$eval('article', articles => articles.length);
      
      if (currentCount === tweetCount && tweetCount > 0) {
        console.log(`📍 No new tweets loaded, stopping at ${tweetCount} tweets`);
        break;
      }
      
      tweetCount = currentCount;
      console.log(`📜 Scroll ${scrollAttempts + 1}: Found ${tweetCount} tweets`);
      
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await new Promise(resolve => setTimeout(resolve, SCROLL_DELAY));
      scrollAttempts++;
    }

    console.log(`✅ Final tweet count: ${tweetCount}`);

    const tweets = await page.evaluate(() => {
      const tweetData = [];
      const articles = document.querySelectorAll('article');
      
      articles.forEach((article, index) => {
        try {
          const textElement = article.querySelector('[data-testid="tweetText"]');
          const text = textElement ? textElement.innerText.trim() : '';
          
          const linkElement = article.querySelector('a[href*="/status/"]');
          const link = linkElement ? 'https://twitter.com' + linkElement.getAttribute('href') : '';
          
          // Better like extraction
          const likeElement = article.querySelector('[data-testid="like"]');
          let likes = 0;
          if (likeElement) {
            const ariaLabel = likeElement.getAttribute('aria-label') || '';
            const likeMatch = ariaLabel.match(/(\d+)/);
            likes = likeMatch ? parseInt(likeMatch[1], 10) : 0;
          }
          
          const verified = !!article.querySelector('[data-testid="icon-verified"]') || 
                          !!article.querySelector('svg[aria-label="Verified account"]');
          
          // Better username extraction
          const userElement = article.querySelector('[data-testid="User-Name"]');
          let username = '';
          if (userElement) {
            const userText = userElement.innerText.split('\n');
            username = userText[0] || '';
          }

          const tweetId = link.match(/status\/(\d+)/)?.[1] || '';
          
          const timeElement = article.querySelector('time');
          const timestamp = timeElement ? timeElement.getAttribute('datetime') : new Date().toISOString();
          
          if (text && link && tweetId) {
            tweetData.push({
              id: tweetId,
              username: username.replace(/^@/, ''), // Remove @ if present
              text,
              link,
              likes,
              verified,
              timestamp,
              scraped_at: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error(`Error processing tweet ${index}:`, e.message);
        }
      });
      
      return tweetData;
    });

    console.log(`🎯 Successfully extracted ${tweets.length} tweets`);
    
    res.json({
      success: true,
      count: tweets.length,
      tweets,
      scraped_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e.message);
      }
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Twitter Scraper API running on port ${PORT}`);
  console.log(`📊 Memory usage:`, process.memoryUsage());
  console.log(`🔍 Chrome executable:`, findChrome() || 'default');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});