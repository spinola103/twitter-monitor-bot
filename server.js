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
    
    // Optimize page settings and disable caching
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'stylesheet' || resourceType === 'image' || resourceType === 'font') {
        req.abort();
      } else {
        // Disable cache for dynamic content
        const headers = req.headers();
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
        headers['Expires'] = '0';
        req.continue({ headers });
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
    
    // Clear cache to ensure fresh content
    await page.evaluate(() => {
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => caches.delete(name));
        });
      }
    });
    
    // Navigate with network idle wait to ensure full loading
    await page.goto(searchURL, { 
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // Wait a bit more for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for tweets to load with multiple selectors
    try {
      await Promise.race([
        page.waitForSelector('article', { timeout: 20000 }),
        page.waitForSelector('[data-testid="tweet"]', { timeout: 20000 }),
        page.waitForSelector('[data-testid="tweetText"]', { timeout: 20000 })
      ]);
      console.log('✅ Tweets container found');
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
    
    // Additional wait for content to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Enhanced scrolling logic to get most recent tweets
    let scrollAttempts = 0;
    let tweetCount = 0;
    let lastTweetCount = 0;
    let stableCount = 0;
    const targetTweets = maxTweets + 10; // Get more tweets to ensure we have recent ones
    const MAX_STABLE_ATTEMPTS = 2; // Stop if count is stable for 2 attempts
    
    console.log(`🎯 Target: ${maxTweets} most recent tweets`);
    
    // First, try to scroll to the very top to ensure we get latest content
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Force refresh of timeline by scrolling down a bit and back up
    await page.evaluate(() => {
      window.scrollBy(0, 200);
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS && tweetCount < targetTweets && stableCount < MAX_STABLE_ATTEMPTS) {
      // Count current tweets
      const currentCount = await page.$eval('article', articles => articles.length);
      
      console.log(`📜 Scroll ${scrollAttempts + 1}: Found ${currentCount} tweets`);
      
      if (currentCount === lastTweetCount) {
        stableCount++;
        console.log(`⏸️ Tweet count stable (${stableCount}/${MAX_STABLE_ATTEMPTS})`);
      } else {
        stableCount = 0; // Reset if we got new tweets
      }
      
      // If we have enough tweets and count is stable, we can stop
      if (currentCount >= maxTweets && stableCount >= MAX_STABLE_ATTEMPTS) {
        console.log(`✅ Found enough tweets (${currentCount}) and count is stable, stopping`);
        break;
      }
      
      lastTweetCount = tweetCount;
      tweetCount = currentCount;
      
      // Controlled scrolling - smaller increments to get more precise loading
      await page.evaluate(() => {
        const scrollHeight = document.documentElement.scrollHeight;
        const currentScroll = window.pageYOffset;
        const clientHeight = window.innerHeight;
        
        // If we're not at the bottom, scroll by one viewport
        if (currentScroll + clientHeight < scrollHeight - 100) {
          window.scrollBy(0, clientHeight * 0.8);
        }
      });
      
      // Wait for content to load with longer delay for recent tweets
      await new Promise(resolve => setTimeout(resolve, SCROLL_DELAY));
      scrollAttempts++;
    }

    console.log(`✅ Final tweet count before processing: ${tweetCount}`);

    const tweets = await page.evaluate((maxTweets) => {
      const tweetData = [];
      const articles = document.querySelectorAll('article');
      const now = new Date();
      
      console.log(`Processing ${articles.length} articles...`);
      
      // Process articles and collect tweet data
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        try {
          // Skip promoted tweets
          if (article.querySelector('[data-testid="promotedIndicator"]')) {
            console.log(`Skipping promoted tweet at index ${i}`);
            continue;
          }
          
          const textElement = article.querySelector('[data-testid="tweetText"]');
          const text = textElement ? textElement.innerText.trim() : '';
          
          const linkElement = article.querySelector('a[href*="/status/"]');
          const link = linkElement ? 'https://twitter.com' + linkElement.getAttribute('href') : '';
          
          // Better like extraction
          const likeElement = article.querySelector('[data-testid="like"]');
          let likes = 0;
          if (likeElement) {
            const ariaLabel = likeElement.getAttribute('aria-label') || '';
            // Try different patterns for like count extraction
            const likeMatch = ariaLabel.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/);
            if (likeMatch) {
              const likeStr = likeMatch[1];
              if (likeStr.includes('K')) {
                likes = Math.floor(parseFloat(likeStr) * 1000);
              } else if (likeStr.includes('M')) {
                likes = Math.floor(parseFloat(likeStr) * 1000000);
              } else {
                likes = parseInt(likeStr.replace(/,/g, ''), 10) || 0;
              }
            }
          }
          
          // Retweet count
          const retweetElement = article.querySelector('[data-testid="retweet"]');
          let retweets = 0;
          if (retweetElement) {
            const ariaLabel = retweetElement.getAttribute('aria-label') || '';
            const retweetMatch = ariaLabel.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/);
            if (retweetMatch) {
              const retweetStr = retweetMatch[1];
              if (retweetStr.includes('K')) {
                retweets = Math.floor(parseFloat(retweetStr) * 1000);
              } else if (retweetStr.includes('M')) {
                retweets = Math.floor(parseFloat(retweetStr) * 1000000);
              } else {
                retweets = parseInt(retweetStr.replace(/,/g, ''), 10) || 0;
              }
            }
          }
          
          // Reply count
          const replyElement = article.querySelector('[data-testid="reply"]');
          let replies = 0;
          if (replyElement) {
            const ariaLabel = replyElement.getAttribute('aria-label') || '';
            const replyMatch = ariaLabel.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/);
            if (replyMatch) {
              const replyStr = replyMatch[1];
              if (replyStr.includes('K')) {
                replies = Math.floor(parseFloat(replyStr) * 1000);
              } else if (replyStr.includes('M')) {
                replies = Math.floor(parseFloat(replyStr) * 1000000);
              } else {
                replies = parseInt(replyStr.replace(/,/g, ''), 10) || 0;
              }
            }
          }
          
          const verified = !!article.querySelector('[data-testid="icon-verified"]') || 
                          !!article.querySelector('svg[aria-label="Verified account"]') ||
                          !!article.querySelector('[aria-label*="Verified"]');
          
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
          let timestamp = timeElement ? timeElement.getAttribute('datetime') : new Date().toISOString();
          const relativeTime = timeElement ? timeElement.innerText : '';
          
          // Parse timestamp to ensure it's valid
          let tweetDate;
          try {
            tweetDate = new Date(timestamp);
            if (isNaN(tweetDate.getTime())) {
              tweetDate = now;
              timestamp = now.toISOString();
            }
          } catch (e) {
            tweetDate = now;
            timestamp = now.toISOString();
          }
          
          // Only include tweets with actual content and valid data
          if (text && link && tweetId) {
            // Check if it's a retweet
            const isRetweet = article.querySelector('[data-testid="socialContext"]')?.innerText?.includes('retweeted') || 
                             article.querySelector('[data-testid="socialContext"]')?.innerText?.includes('Retweeted') ||
                             text.startsWith('RT @') ||
                             false;
            
            // Calculate age in hours for debugging
            const ageHours = (now - tweetDate) / (1000 * 60 * 60);
            
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
              ageHours: Math.round(ageHours * 100) / 100, // Round to 2 decimal places
              position: i + 1, // Track position in original timeline
              scraped_at: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error(`Error processing tweet ${i}:`, e.message);
        }
      }
      
      console.log(`Extracted ${tweetData.length} valid tweets from ${articles.length} articles`);
      return tweetData;
    }, maxTweets);

    // Sort tweets by timestamp to ensure we have the most recent ones first
    tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Take only the requested number of most recent tweets
    const recentTweets = tweets.slice(0, maxTweets);
    
    // Add final position numbers based on recency
    recentTweets.forEach((tweet, index) => {
      tweet.finalPosition = index + 1;
    });

    console.log(`🎯 Successfully extracted ${recentTweets.length} most recent tweets`);
    
    // Log the age distribution for debugging
    const ageDistribution = recentTweets.map(t => ({ 
      id: t.id, 
      relativeTime: t.relativeTime, 
      ageHours: t.ageHours 
    }));
    console.log('📊 Tweet age distribution:', ageDistribution);
    
    res.json({
      success: true,
      count: recentTweets.length,
      requested: maxTweets,
      tweets: recentTweets,
      scraped_at: new Date().toISOString(),
      profile_url: searchURL,
      debug: {
        totalTweetsFound: tweets.length,
        oldestTweetHours: tweets.length > 0 ? Math.max(...tweets.map(t => t.ageHours)) : 0,
        newestTweetHours: tweets.length > 0 ? Math.min(...tweets.map(t => t.ageHours)) : 0
      }
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