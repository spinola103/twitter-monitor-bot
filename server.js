const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let browser = null;

// Initialize browser once
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    console.log('🚀 Starting browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      ]
    });
  }
  return browser;
}

// Single endpoint to get recent tweets
app.post('/recent-tweets', async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  const startTime = Date.now();
  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    // Set realistic headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Go to profile page
    const profileUrl = `https://x.com/${username}`;
    console.log(`🌐 Loading: ${profileUrl}`);
    
    await page.goto(profileUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Wait a bit for content to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract tweets
    const tweets = await page.evaluate(() => {
      const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
      const results = [];
      
      console.log(`Found ${tweetElements.length} tweet elements`);
      
      for (let i = 0; i < Math.min(4, tweetElements.length); i++) {
        const tweet = tweetElements[i];
        
        try {
          // Get tweet text
          const textElement = tweet.querySelector('[data-testid="tweetText"]');
          const text = textElement ? textElement.textContent.trim() : '';
          
          // Get tweet link and ID
          const linkElement = tweet.querySelector('a[href*="/status/"]');
          if (!linkElement) continue;
          
          const href = linkElement.href;
          const tweetId = href.match(/status\/(\d+)/)?.[1];
          
          // Get timestamp
          const timeElement = tweet.querySelector('time');
          let timestamp = '';
          let relativeTime = '';
          
          if (timeElement) {
            timestamp = timeElement.getAttribute('datetime') || '';
            relativeTime = timeElement.textContent.trim();
          }
          
          // Get engagement metrics
          const getCount = (testId) => {
            const element = tweet.querySelector(`[data-testid="${testId}"]`);
            if (!element) return 0;
            
            const text = element.textContent.trim();
            const match = text.match(/[\d,]+/);
            return match ? parseInt(match[0].replace(',', '')) : 0;
          };
          
          const likes = getCount('like') || getCount('favorite');
          const retweets = getCount('retweet');
          const replies = getCount('reply');
          
          // Check for media
          const hasImage = !!tweet.querySelector('img[src*="media"]');
          const hasVideo = !!tweet.querySelector('video');
          
          if (text || hasImage || hasVideo) {
            results.push({
              id: tweetId,
              text: text,
              link: href,
              timestamp: timestamp,
              relativeTime: relativeTime,
              likes: likes,
              retweets: retweets,
              replies: replies,
              hasMedia: hasImage || hasVideo,
              scraped_at: new Date().toISOString()
            });
          }
          
        } catch (error) {
          console.log(`Error processing tweet ${i}:`, error.message);
        }
      }
      
      return results;
    });

    await page.close();

    const totalTime = Date.now() - startTime;

    console.log(`✅ Found ${tweets.length} recent tweets in ${totalTime}ms`);

    res.json({
      success: true,
      username: username,
      count: tweets.length,
      tweets: tweets,
      scraped_at: new Date().toISOString(),
      time_ms: totalTime
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (page) {
      try { await page.close(); } catch (e) {}
    }

    res.status(500).json({
      success: false,
      error: error.message,
      username: username,
      scraped_at: new Date().toISOString()
    });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Recent Tweets Scraper Ready',
    endpoint: 'POST /recent-tweets',
    example: { username: 'elonmusk' }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('📝 Usage: POST /recent-tweets with {"username": "twitter_handle"}');
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
  }
  process.exit();
});
