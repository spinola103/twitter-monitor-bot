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
    status: 'Twitter Scraper API Ready - Top 10 Recent Tweets', 
    chrome: chromePath || 'default',
    timestamp: new Date().toISOString() 
  });
});

// Main scraping endpoint for top 10 recent tweets
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  const maxTweets = req.body.maxTweets || 10; // Default to 10, allow customization
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  const SCROLL_DELAY = parseInt(process.env.SCROLL_DELAY) || 1500; // Reduced delay
  const MAX_SCROLL_ATTEMPTS = 3; // Reduced since we only need 10 tweets

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
      timeout: 30000
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

    // Modified scrolling logic to get top 10 recent tweets
    let scrollAttempts = 0;
    let tweetCount = 0;
    const targetTweets = maxTweets + 5; // Get a few extra to ensure we have enough valid tweets
    
    console.log(`🎯 Target: ${maxTweets} most recent tweets`);
    
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS && tweetCount < targetTweets) {
      const currentCount = await page.$$eval('article', articles => articles.length);
      
      if (currentCount === tweetCount && tweetCount > 0) {
        console.log(`📍 No new tweets loaded after ${scrollAttempts} scrolls`);
        break;
      }
      
      // If we have enough tweets, stop scrolling
      if (currentCount >= targetTweets) {
        console.log(`✅ Found enough tweets (${currentCount}), stopping scroll`);
        break;
      }
      
      tweetCount = currentCount;
      console.log(`📜 Scroll ${scrollAttempts + 1}: Found ${tweetCount} tweets`);
      
      // Smaller scroll to load tweets more gradually
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
      await new Promise(resolve => setTimeout(resolve, SCROLL_DELAY));
      scrollAttempts++;
    }

    console.log(`✅ Final tweet count before processing: ${tweetCount}`);

    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const articles = document.querySelectorAll('article');
      
      // Process articles and collect tweet data
      for (let i = 0; i < articles.length && tweetData.length < maxTweets; i++) {
        const article = articles[i];
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
          
          // Retweet count
          const retweetElement = article.querySelector('[data-testid="retweet"]');
          let retweets = 0;
          if (retweetElement) {
            const ariaLabel = retweetElement.getAttribute('aria-label') || '';
            const retweetMatch = ariaLabel.match(/(\d+)/);
            retweets = retweetMatch ? parseInt(retweetMatch[1], 10) : 0;
          }
          
          // Reply count
          const replyElement = article.querySelector('[data-testid="reply"]');
          let replies = 0;
          if (replyElement) {
            const ariaLabel = replyElement.getAttribute('aria-label') || '';
            const replyMatch = ariaLabel.match(/(\d+)/);
            replies = replyMatch ? parseInt(replyMatch[1], 10) : 0;
          }
          
          const verified = !!article.querySelector('[data-testid="icon-verified"]') || 
                          !!article.querySelector('svg[aria-label="Verified account"]');
          
          // Better username extraction
          const userElement = article.querySelector('[data-testid="User-Name"]');
          let username = '';
          let displayName = '';
          if (userElement) {
            const userText = userElement.innerText.split('\n');
            displayName = userText[0] || '';
            username = userText[1] || '';
          }

          const tweetId = link.match(/status\/(\d+)/)?.[1] || '';
          
          const timeElement = article.querySelector('time');
          const timestamp = timeElement ? timeElement.getAttribute('datetime') : new Date().toISOString();
          const relativeTime = timeElement ? timeElement.innerText : '';
          
          // Only include tweets with actual content (skip retweets without comments)
          if (text && link && tweetId) {
            // Check if it's a retweet
            const isRetweet = article.querySelector('[data-testid="socialContext"]')?.innerText?.includes('retweeted') || false;
            
            tweetData.push({
              id: tweetId,
              username: username.replace(/^@/, ''), // Remove @ if present
              displayName: displayName,
              text,
              link,
              likes,
              retweets,
              replies,
              verified,
              timestamp,
              relativeTime,
              isRetweet,
              position: tweetData.length + 1, // Track position in timeline
              scraped_at: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error(`Error processing tweet ${i}:`, e.message);
        }
      }
      
      return tweetData;
    }, maxTweets);

    // Sort tweets by timestamp to ensure we have the most recent ones
    tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Take only the requested number of most recent tweets
    const recentTweets = tweets.slice(0, maxTweets);

    console.log(`🎯 Successfully extracted ${recentTweets.length} most recent tweets`);
    
    res.json({
      success: true,
      count: recentTweets.length,
      requested: maxTweets,
      tweets: recentTweets,
      scraped_at: new Date().toISOString(),
      profile_url: searchURL
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

// New endpoint specifically for getting recent tweets from a username
app.post('/scrape-user', async (req, res) => {
  const username = req.body.username;
  const maxTweets = req.body.maxTweets || 10;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  // Clean username (remove @ if present)
  const cleanUsername = username.replace(/^@/, '');
  const profileURL = `https://x.com/${cleanUsername}`;
  
  // Use the existing scrape logic
  req.body.url = profileURL;
  req.body.maxTweets = maxTweets;
  
  // Forward to main scrape endpoint
  return app._router.handle({ ...req, url: '/scrape', method: 'POST' }, res);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Twitter Scraper API running on port ${PORT}`);
  console.log(`📊 Memory usage:`, process.memoryUsage());
  console.log(`🔍 Chrome executable:`, findChrome() || 'default');
  console.log(`🎯 Configured for top 10 most recent tweets per account`);
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