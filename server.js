const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Twitter Scraper API Ready', timestamp: new Date().toISOString() });
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const searchURL = req.body.url || process.env.TWITTER_SEARCH_URL;
  
  if (!searchURL) {
    return res.status(400).json({ error: 'No Twitter URL provided' });
  }

  const SCROLL_DELAY = parseInt(process.env.SCROLL_DELAY) || 2000;
  const MAX_SCROLL_ATTEMPTS = parseInt(process.env.MAX_SCROLL_ATTEMPTS) || 5;

  try {
    const browser = await puppeteer.launch({
      headless: 'new', // ✅ Force headless for Railway
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-features=VizDisplayCompositor',
        '--window-size=1200,800'
      ],
      defaultViewport: null
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // ✅ Load cookies from environment variable
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
      timeout: 60000 
    });

    // Wait for the main content to load
    await page.waitForSelector('article', { timeout: 15000 });

    // Scroll to load more tweets
    let scrollAttempts = 0;
    let tweetCount = 0;
    
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
      const currentCount = await page.$$eval('article', articles => articles.length);
      
      if (currentCount === tweetCount && tweetCount > 0) {
        break;
      }
      
      tweetCount = currentCount;
      
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      
      await new Promise(resolve => setTimeout(resolve, SCROLL_DELAY));
      scrollAttempts++;
    }

    console.log(`✅ Loaded ${tweetCount} tweets`);

    // Extract tweets - your existing logic
    const tweets = await page.evaluate(() => {
      const tweetData = [];
      const articles = document.querySelectorAll('article');
      
      articles.forEach(article => {
        try {
          const textElement = article.querySelector('[data-testid="tweetText"]');
          const text = textElement ? textElement.innerText : '';
          
          const linkElement = article.querySelector('a[href*="/status/"]');
          const link = linkElement ? 'https://twitter.com' + linkElement.getAttribute('href') : '';
          
          const likeElement = article.querySelector('[data-testid="like"]');
          const likesText = likeElement ? likeElement.getAttribute('aria-label').match(/\d+/g) : null;
          const likes = likesText ? parseInt(likesText[0], 10) : 0;
          
          const verified = !!article.querySelector('[data-testid="icon-verified"]');
          
          const userElement = article.querySelector('[data-testid="User-Name"]');
          const username = userElement ? userElement.innerText.split('\n')[0] : '';

          // Get tweet ID
          const tweetId = link.match(/status\/(\d+)/)?.[1] || '';
          
          // Get timestamp
          const timeElement = article.querySelector('time');
          const timestamp = timeElement ? timeElement.getAttribute('datetime') : new Date().toISOString();
          
          if (text && link) {
            tweetData.push({
              id: tweetId,
              username,
              text,
              link,
              likes,
              verified,
              timestamp,
              scraped_at: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('Error processing tweet:', e);
        }
      });
      
      return tweetData;
    });

    await browser.close();
    
    // ✅ Return JSON response instead of console.log
    res.json({
      success: true,
      count: tweets.length,
      tweets: tweets,
      scraped_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Twitter Scraper API running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`🐦 Scrape endpoint: POST http://localhost:${PORT}/scrape`);
});