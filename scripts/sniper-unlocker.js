'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { readExistingPatterns, updatePatternEntry } = require('./lib/result-writer');
const { getRandomUserAgent } = require('./lib/waf-detector');
const { REQUEST_TIMEOUT_MS, POLITE_DELAY_MS, TARGET_KEYWORD, HTTP_STATUS } = require('./lib/constants');

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';

const MOBILE_HEADERS = {
  'User-Agent': MOBILE_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua-Mobile': '?1',
  'Sec-Ch-Ua-Platform': '"Android"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Connection': 'keep-alive',
  'Cache-Control': 'max-age=0'
};

function validatePageUnlocked(html, domain) {
  if (!html || typeof html !== 'string' || html.length < 500) {
    return { valid: false, reason: 'Content too short or empty' };
  }

  const $ = cheerio.load(html);

  if ($('body').length === 0) {
    return { valid: false, reason: 'No body element' };
  }

  const bodyText = $('body').text().trim();
  if (bodyText.length < 100) {
    return { valid: false, reason: 'Body text too short (< 100 chars)' };
  }

  const blockPatterns = [
    /access denied/i,
    /blocked/i,
    /captcha/i,
    /challenge platform/i,
    /cloudflare/i,
    /checking your browser/i,
    /please enable javascript/i,
    /enable cookies/i,
    /browser check/i,
    /security check/i,
    /ray id/i,
    /ddos protection/i,
    /just a moment/i,
    /please turn javascript on and reload/i,
    /please wait while we verify/i,
    /you have been blocked/i,
    /sorry, you have been blocked/i,
    /your request has been blocked/i
  ];

  for (const pattern of blockPatterns) {
    if (pattern.test(bodyText)) {
      return { valid: false, reason: `Block page detected: ${pattern.source}` };
    }
  }

  const hasContentElements = $(
    'main, article, section, .content, .main, .container, #main, #content, ' +
    'nav, header, .header, .navigation, [role="navigation"], ' +
    'footer, .footer, ' +
    '[class*="job"], [class*="search"], [class*="result"], [id*="job"], [id*="search"], [id*="result"]'
  ).length > 0;

  if (!hasContentElements) {
    return { valid: false, reason: 'No recognizable page structure' };
  }

  const sanitizedDomain = domain.toLowerCase().replace(/[^a-z0-9.-]/g, '');
  const currentHostname = bodyText.includes(sanitizedDomain) ||
    html.includes(sanitizedDomain);

  return { valid: true, reason: 'Valid unlocked page', currentHostname };
}

// ===== Tactic 1: Raw Mobile-App Footprint (Axios) =====
async function tactic1MobileAxios(entry) {
  const domain = entry.domain;
  const baseUrl = entry.validatedUrl || entry.finalUrl || `https://${domain}`;

  console.log(`  [Tactic 1] Mobile Axios probe: ${domain}`);

  const mobileAxios = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    headers: { ...MOBILE_HEADERS },
    validateStatus: (s) => s < 500
  });

  try {
    const response = await mobileAxios.get(baseUrl);

    console.log(`    Status: ${response.status}, Content-Type: ${(response.headers['content-type'] || '').substring(0, 40)}`);

    if (response.status === HTTP_STATUS.FORBIDDEN || response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      console.log(`    Blocked (${response.status})`);
      return null;
    }

    if (response.status !== HTTP_STATUS.OK) {
      console.log(`    Non-200 response (${response.status})`);
      return null;
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data || '');
    const validation = validatePageUnlocked(html, domain);

    if (!validation.valid) {
      console.log(`    Page not unlocked: ${validation.reason}`);
      return null;
    }

    const finalUrl = response.request?.res?.responseUrl || baseUrl;

    console.log(`    Unlocked! ${html.length} bytes, final URL: ${finalUrl.substring(0, 80)}`);

    return {
      scraperType: 'Cheerio-Mobile',
      extractionStrategy: 'Mobile-WebView',
      paradigm: 'Mobile-Unlocked',
      tier: 'Tier 2 (Challenged)',
      urlPattern: baseUrl,
      validatedUrl: finalUrl,
      finalUrl: finalUrl,
      statusCode: response.status,
      discoveredAt: new Date().toISOString()
    };

  } catch (error) {
    const reason = error.code || error.message;
    console.log(`    Request failed: ${reason}`);
    return null;
  }
}

// ===== Tactic 2: Playwright Mobile Device Emulation =====
async function tactic2PlaywrightMobile(entry) {
  const domain = entry.domain;
  const baseUrl = entry.validatedUrl || entry.finalUrl || `https://${domain}`;

  console.log(`  [Tactic 2] Playwright Mobile emulation: ${domain}`);

  let browser;
  try {
    const { chromium, devices } = require('playwright');

    const pixel5 = devices['Pixel 5'];
    if (!pixel5) {
      console.log(`    Pixel 5 device profile not available, using manual config`);
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const contextOptions = pixel5 ? {
      ...pixel5,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      bypassCSP: true,
      javaScriptEnabled: true
    } : {
      userAgent: MOBILE_UA,
      viewport: { width: 393, height: 851 },
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      bypassCSP: true,
      javaScriptEnabled: true
    };

    const context = await browser.newContext(contextOptions);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      if (navigator.connection) {
        Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
        Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
      }
    });

    const page = await context.newPage();

    try {
      await page.goto(baseUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25000
      });
    } catch (navError) {
      console.log(`    Navigation error: ${navError.message}`);
      await browser.close();
      return null;
    }

    await page.waitForTimeout(5000);

    try {
      await page.evaluate(() => {
        const scrollStep = Math.floor(Math.random() * 300) + 200;
        window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      });
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        window.scrollBy({ top: 400, behavior: 'smooth' });
      });
      await page.waitForTimeout(500);
    } catch {}

    const finalUrl = page.url();
    const pageTitle = await page.title();
    let html = '';
    try {
      html = await page.content();
    } catch {}

    await browser.close();

    if (!html || html.length < 500) {
      console.log(`    Page content too short (${html ? html.length : 0} bytes)`);
      return null;
    }

    const validation = validatePageUnlocked(html, domain);
    if (!validation.valid) {
      console.log(`    Still blocked: ${validation.reason}`);
      return null;
    }

    const resolvedUrl = finalUrl && finalUrl !== 'about:blank' ? finalUrl : baseUrl;

    console.log(`    Unlocked! ${html.length} bytes, resolved: ${resolvedUrl.substring(0, 80)}`);
    console.log(`    Title: "${pageTitle.substring(0, 60)}"`);

    return {
      scraperType: 'Playwright-Mobile',
      extractionStrategy: 'Mobile-Device-Emulation',
      paradigm: 'Mobile-Unlocked',
      tier: 'Tier 2 (Challenged)',
      urlPattern: resolvedUrl,
      validatedUrl: resolvedUrl,
      finalUrl: resolvedUrl,
      statusCode: 200,
      discoveredAt: new Date().toISOString()
    };

  } catch (error) {
    console.log(`    Playwright error: ${error.message}`);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

// ===== Main Runner =====
async function runSniper(options = {}) {
  const { dryRun = false, onlyDomain = null } = options;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     SNIPER UNLOCKER — Mobile Spoof Interception      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const patterns = await readExistingPatterns();
  const entries = Object.entries(patterns);

  const sniperTargets = entries.filter(([, entry]) => {
    if (onlyDomain && entry.domain !== onlyDomain) return false;
    return entry.scraperType === 'Sniper-Pending';
  });

  console.log(`Loaded ${entries.length} platform entries`);
  console.log(`Sniper-Pending targets: ${sniperTargets.length}\n`);

  if (sniperTargets.length === 0) {
    console.log('No sniper targets found. Nothing to do.');
    return { total: 0, unlocked: 0, stillPending: 0 };
  }

  let unlocked = 0;
  let stillPending = 0;

  for (let i = 0; i < sniperTargets.length; i++) {
    const [key, entry] = sniperTargets[i];
    const domain = entry.domain;

    console.log(`[${i + 1}/${sniperTargets.length}] ${domain}`);
    console.log(`    Tier: ${entry.tier} | Status: ${entry.statusCode}`);

    let result = null;

    if (!dryRun) {
      result = await tactic1MobileAxios(entry);

      if (!result) {
        result = await tactic2PlaywrightMobile(entry);
      }
    } else {
      console.log(`  [DRY-RUN] Would execute Tactic 1 → Tactic 2`);
    }

    if (result) {
      if (!dryRun) {
        await updatePatternEntry(key, result);
      }
      unlocked++;
      console.log(`    Sniper success: ${result.scraperType}\n`);
    } else {
      stillPending++;
      console.log(`    Sniper failed — remains Sniper-Pending\n`);
    }

    if (i < sniperTargets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, POLITE_DELAY_MS));
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  if (dryRun) {
    console.log(`DRY RUN COMPLETE — ${sniperTargets.length} targets would be processed`);
  } else {
    console.log(`SNIPER COMPLETE`);
    console.log(`  Unlocked: ${unlocked}/${sniperTargets.length}`);
    console.log(`  Still pending: ${stillPending}/${sniperTargets.length}`);
  }
  console.log('═══════════════════════════════════════════════════════\n');

  return { total: sniperTargets.length, unlocked, stillPending };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    onlyDomain: (() => {
      const idx = args.indexOf('--only');
      return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
    })()
  };

  runSniper(options)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = {
  runSniper,
  tactic1MobileAxios,
  tactic2PlaywrightMobile,
  validatePageUnlocked
};
