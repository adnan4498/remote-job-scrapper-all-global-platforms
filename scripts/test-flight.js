'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { readExistingPatterns } = require('./lib/result-writer');
const { getRandomUserAgent } = require('./lib/waf-detector');
const { REQUEST_TIMEOUT_MS, TARGET_KEYWORD } = require('./lib/constants');

const BATCH_SIZE = 5;
const FETCH_TIMEOUT_MS = 20000;

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';

const MOBILE_HEADERS = {
  'User-Agent': MOBILE_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua-Mobile': '?1',
  'Sec-Ch-Ua-Platform': '"Android"',
  'Connection': 'keep-alive',
  'Cache-Control': 'max-age=0'
};

const GENERIC_JOB_SELECTORS = [
  '.job-card', '.job-listing', '.job-item', '.job',
  '[class*="job-card"]', '[class*="job-listing"]', '[class*="job-item"]',
  '.JobCard', '.JobListing', '.JobItem',
  '.search-result', '.search-result-item', '.result-card',
  '.vacancy', '.vacancy-card', '.position', '.position-card',
  '.opportunity', '.career-item', '.posting', '.posting-item',
  '.listing-item', '.list-item', '.srp-result',
  '[data-testid*="job"]', '[data-cy*="job"]',
  '[data-automation*="jobCard"]', '[data-automation*="job-card"]',
  '[data-automation*="jobTitle"]', '[data-automation*="searchResultItem"]',
  '.result', '.results-item', '.serp-item', '.serp-card',
  '.jobs-list > *', '.job-list > *', '.listings > *',
  'article[class*="job"]', 'li[class*="job"]', 'div[class*="job"]',
  '[class*="JobSearchResult"]', '[class*="SearchResult"]',
  '.ais-Hits-item', '.hit', '[class*="hit-item"]',
  '[class*="job-card-"]', '[class*="JobCard-"]'
];

function countJobElements($) {
  for (const selector of GENERIC_JOB_SELECTORS) {
    try {
      const elements = $(selector);
      if (elements.length >= 2 && elements.length < 500) {
        return { count: elements.length, selector };
      }
    } catch {}
  }
  return { count: 0, selector: 'none' };
}

function extractHydrationJobs(html, extractionStrategy) {
  const $ = cheerio.load(html);

  if (extractionStrategy && extractionStrategy.includes('NEXT_DATA')) {
    const nextDataEl = $('#__NEXT_DATA__');
    if (nextDataEl.length > 0) {
      try {
        const data = JSON.parse(nextDataEl.html());
        const arrays = findJobArrays(data);
        if (arrays.length > 0) return { count: arrays[0].length, source: '__NEXT_DATA__', sample: arrays[0].slice(0, 2) };
      } catch {}
    }
  }

  if (extractionStrategy && extractionStrategy.includes('JSON-LD')) {
    const ldScripts = $('script[type="application/ld+json"]');
    let count = 0;
    for (let i = 0; i < ldScripts.length; i++) {
      try {
        const json = JSON.parse($(ldScripts[i]).html() || '');
        if (json && (json['@type'] === 'JobPosting' || json['@type'] === 'ItemList')) {
          count++;
        }
      } catch {}
    }
    if (count > 0) return { count, source: 'JSON-LD', sample: [] };
  }

  if (extractionStrategy && extractionStrategy.includes('Hydration')) {
    const scripts = $('script:not([src])');
    for (let i = 0; i < scripts.length; i++) {
      const content = $(scripts[i]).html() || '';
      const windowAssigns = content.match(/window\.__(\w+)__\s*=\s*({[^;]+|\[[^\]]+\])/g);
      if (windowAssigns) {
        for (const assign of windowAssigns) {
          try {
            const match = assign.match(/=\s*(.+)$/);
            if (match) {
              const parsed = JSON.parse(match[1]);
              const arrays = findJobArrays(parsed);
              if (arrays.length > 0) return { count: arrays[0].length, source: 'window-hydration', sample: arrays[0].slice(0, 2) };
            }
          } catch {}
        }
      }
    }
  }

  const genericResult = countJobElements($);
  return { count: genericResult.count, source: genericResult.selector, sample: [] };
}

function findJobArrays(data, depth = 0) {
  if (depth > 6) return [];
  const results = [];

  if (Array.isArray(data) && data.length >= 2 && data.length < 1000) {
    const firstItem = data[0];
    if (firstItem && typeof firstItem === 'object') {
      const keys = Object.keys(firstItem).map(k => k.toLowerCase());
      const jobKeys = ['title', 'company', 'location', 'job', 'description', 'url', 'salary'];
      const matchCount = jobKeys.filter(k => keys.some(jk => jk.includes(k))).length;
      if (matchCount >= 2) {
        results.push(data);
      }
    }
  }

  if (data && typeof data === 'object') {
    const entries = Array.isArray(data) ? data : Object.values(data);
    for (const value of entries) {
      if (value && typeof value === 'object') {
        results.push(...findJobArrays(value, depth + 1));
      }
    }
  }

  return results;
}

// ===== Engine: Cheerio-Static =====
async function engineCheerioStatic(entry) {
  const url = entry.urlPattern || entry.validatedUrl || entry.finalUrl || `https://${entry.domain}`;

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 5,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      validateStatus: (s) => s < 500
    });

    if (response.status !== 200) return { count: 0, source: `HTTP ${response.status}`, sample: [] };

    const html = typeof response.data === 'string' ? response.data : String(response.data || '');
    if (html.length < 300) return { count: 0, source: 'empty-response', sample: [] };

    const $ = cheerio.load(html);
    const result = countJobElements($);
    return result;

  } catch (error) {
    throw error;
  }
}

// ===== Engine: Cheerio-Hydrated =====
async function engineCheerioHydrated(entry) {
  const url = entry.urlPattern || entry.validatedUrl || entry.finalUrl || `https://${entry.domain}`;

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 5,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      validateStatus: (s) => s < 500
    });

    if (response.status !== 200) return { count: 0, source: `HTTP ${response.status}`, sample: [] };

    const html = typeof response.data === 'string' ? response.data : String(response.data || '');
    if (html.length < 300) return { count: 0, source: 'empty-response', sample: [] };

    const result = extractHydrationJobs(html, entry.extractionStrategy);

    if (result.count === 0) {
      const $ = cheerio.load(html);
      const fallback = countJobElements($);
      return fallback;
    }

    return result;

  } catch (error) {
    throw error;
  }
}

// ===== Engine: Cheerio-Mobile =====
async function engineCheerioMobile(entry) {
  const url = entry.urlPattern || entry.validatedUrl || entry.finalUrl || `https://${entry.domain}`;

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 5,
      headers: { ...MOBILE_HEADERS },
      validateStatus: (s) => s < 500
    });

    if (response.status !== 200) return { count: 0, source: `HTTP ${response.status}`, sample: [] };

    const html = typeof response.data === 'string' ? response.data : String(response.data || '');
    if (html.length < 300) return { count: 0, source: 'empty-response', sample: [] };

    const $ = cheerio.load(html);

    if (entry.extractionStrategy && entry.extractionStrategy !== 'Mobile-WebView') {
      const hydrated = extractHydrationJobs(html, entry.extractionStrategy);
      if (hydrated.count > 0) return hydrated;
    }

    const result = countJobElements($);
    return result;

  } catch (error) {
    throw error;
  }
}

// ===== Engine: Playwright-Stealth / Playwright-Mobile =====
async function enginePlaywright(entry) {
  const url = entry.validatedUrl || entry.finalUrl || entry.urlPattern || `https://${entry.domain}`;
  const isMobile = entry.scraperType && entry.scraperType.includes('Mobile');

  let browser;
  try {
    const { chromium, devices } = require('playwright');

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
    });

    let contextOptions;
    if (isMobile) {
      const pixel5 = devices['Pixel 5'];
      contextOptions = pixel5 ? { ...pixel5 } : {
        userAgent: MOBILE_UA,
        viewport: { width: 393, height: 851 },
        deviceScaleFactor: 2.75,
        isMobile: true,
        hasTouch: true
      };
    } else {
      contextOptions = {
        userAgent: getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        isMobile: false,
        hasTouch: false
      };
    }

    contextOptions.locale = 'en-US';
    contextOptions.timezoneId = 'America/New_York';
    contextOptions.bypassCSP = true;
    contextOptions.javaScriptEnabled = true;

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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (navErr) {
      await browser.close();
      return { count: 0, source: `nav-error: ${navErr.message.substring(0, 40)}`, sample: [] };
    }

    await page.waitForTimeout(5000);

    try {
      await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
      await page.waitForTimeout(500);
    } catch {}

    let html = '';
    try { html = await page.content(); } catch {}

    await browser.close();

    if (!html || html.length < 500) return { count: 0, source: 'empty-page', sample: [] };

    const $ = cheerio.load(html);
    const result = countJobElements($);
    return result;

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
}

// ===== Engine Classification =====
function classifyEngine(entry) {
  const scraperType = entry.scraperType || '';
  const paradigm = entry.paradigm || '';

  if (scraperType.includes('Playwright')) {
    return 'Playwright';
  }
  if (scraperType === 'Cheerio-Hydrated' || scraperType === 'Hydrated-JSON') {
    return 'Cheerio-Hydrated';
  }
  if (scraperType === 'Cheerio-Mobile') {
    return 'Cheerio-Mobile';
  }

  if (entry.urlPattern && entry.urlPattern.length > 10) {
    return 'Cheerio-Static';
  }

  if (entry.validatedUrl || entry.finalUrl) {
    return 'Cheerio-Static';
  }

  return 'Cheerio-Static';
}

// ===== Single Platform Processor =====
async function processPlatform(key, entry, index, total) {
  const domain = entry.domain;
  const engine = classifyEngine(entry);

  try {
    let result;

    switch (engine) {
      case 'Cheerio-Static':
        result = await engineCheerioStatic(entry);
        break;
      case 'Cheerio-Hydrated':
        result = await engineCheerioHydrated(entry);
        break;
      case 'Cheerio-Mobile':
        result = await engineCheerioMobile(entry);
        break;
      case 'Playwright':
        result = await enginePlaywright(entry);
        break;
      default:
        result = await engineCheerioStatic(entry);
    }

    const count = result.count || 0;
    const source = result.source || 'unknown';
    console.log(`[${index}/${total}] ${domain} -> ${engine} -> Found ${count} jobs (${source})`);

    return { domain, engine, count, source, success: true };

  } catch (error) {
    const reason = error.code || error.message || 'unknown';
    console.log(`[${index}/${total}] ${domain} -> ${engine} -> Error/Timeout (0 jobs) [${reason.substring(0, 50)}]`);
    return { domain, engine, count: 0, source: `error: ${reason.substring(0, 40)}`, success: false };
  }
}

// ===== Batch Runner =====
async function runBatch(batch, batchNum, totalBatches, overallIndex, totalActive) {
  const results = [];
  const promises = batch.map(([key, entry], i) => {
    const globalIndex = overallIndex + i + 1;
    return processPlatform(key, entry, globalIndex, totalActive);
  });

  const settled = await Promise.allSettled(promises);
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      results.push({ domain: 'unknown', engine: 'unknown', count: 0, source: 'promise-rejection', success: false });
    }
  }

  return results;
}

// ===== Main Runner =====
async function runTestFlight(options = {}) {
  const { dryRun = false, onlyDomain = null } = options;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        TEST FLIGHT — Page-1 Volume Evaluation         ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const allPatterns = await readExistingPatterns();
  const entries = Object.entries(allPatterns);

  const active = entries.filter(([, entry]) => {
    if (entry.scraperType === 'Sniper-Pending') return false;
    if (onlyDomain && entry.domain !== onlyDomain) return false;
    return true;
  });

  const skipped = entries.length - active.length;
  console.log(`Total entries: ${entries.length}`);
  console.log(`Sniper-Pending skipped: ${skipped}`);
  console.log(`Active platforms: ${active.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Timeout per request: ${FETCH_TIMEOUT_MS / 1000}s\n`);

  if (active.length === 0) {
    console.log('No active platforms to test.');
    return { total: 0, totalJobs: 0, results: [] };
  }

  if (dryRun) {
    console.log('-- DRY RUN -- Classification only:\n');
    let idx = 0;
    for (const [key, entry] of active) {
      const engine = classifyEngine(entry);
      console.log(`[${++idx}/${active.length}] ${entry.domain} -> ${engine} -> (dry-run)`);
    }
    console.log('\nDry run complete.');
    return { total: active.length, totalJobs: 0, results: [] };
  }

  const startTime = Date.now();
  const allResults = [];
  let globalIndex = 0;

  for (let i = 0; i < active.length; i += BATCH_SIZE) {
    const batch = active.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(active.length / BATCH_SIZE);

    if (batchNum > 1) {
      console.log(`--- Batch ${batchNum}/${totalBatches} ---`);
    }

    const batchResults = await runBatch(batch, batchNum, totalBatches, globalIndex, active.length);
    allResults.push(...batchResults);
    globalIndex += batch.length;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalJobs = allResults.reduce((sum, r) => sum + (r.count || 0), 0);
  const successCount = allResults.filter(r => r.success).length;
  const failCount = allResults.filter(r => !r.success).length;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('                TEST FLIGHT COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Platforms tested: ${active.length}`);
  console.log(`  Successful: ${successCount}`);
  console.log(`  Failed/Timeout: ${failCount}`);
  console.log(`  Total page-1 jobs harvested: ${totalJobs}`);
  console.log(`  Elapsed: ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════\n');

  const engineStats = {};
  for (const r of allResults) {
    if (!engineStats[r.engine]) engineStats[r.engine] = { count: 0, jobs: 0 };
    engineStats[r.engine].count++;
    engineStats[r.engine].jobs += (r.count || 0);
  }
  console.log('Per-engine breakdown:');
  for (const [engine, stats] of Object.entries(engineStats)) {
    console.log(`  ${engine}: ${stats.count} platforms, ${stats.jobs} jobs`);
  }

  return { total: active.length, totalJobs, results: allResults };
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

  runTestFlight(options)
    .then(({ totalJobs }) => {
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = {
  runTestFlight,
  classifyEngine,
  engineCheerioStatic,
  engineCheerioHydrated,
  engineCheerioMobile,
  enginePlaywright,
  countJobElements,
  extractHydrationJobs,
  findJobArrays
};
