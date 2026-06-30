'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { readExistingPatterns, updatePatternEntry, overwriteAllPatterns } = require('./lib/result-writer');
const { getRandomUserAgent, politeDelay } = require('./lib/waf-detector');
const { REQUEST_TIMEOUT_MS, POLITE_DELAY_MS, USER_AGENTS, TARGET_KEYWORD, HTTP_STATUS } = require('./lib/constants');

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

function hasJobStructures(data) {
  if (!data) return false;
  const json = JSON.stringify(data).toLowerCase();
  const jobKeywords = ['job', 'jobs', 'position', 'career', 'vacancy', 'hiring', 'employment', 'title', 'company', 'location', 'salary', 'remote'];
  let matchCount = 0;
  for (const kw of jobKeywords) {
    if (json.includes(kw)) matchCount++;
  }
  return matchCount >= 3;
}

async function createHydrationAxiosInstance() {
  return axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    },
    validateStatus: (s) => s < 500
  });
}

// ===== Tactic A: JSON Hydration Audit =====
async function tacticAHydration(entry) {
  const domain = entry.domain;
  const baseUrl = `https://${domain}`;

  console.log(`  [Tactic A] Hydration audit for ${domain}...`);

  try {
    const instance = await createHydrationAxiosInstance();
    const response = await instance.get(baseUrl);

    if (response.status !== HTTP_STATUS.OK || !response.data) {
      console.log(`    No valid HTML (status ${response.status})`);
      return null;
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data);
    const $ = cheerio.load(html);

    const nextDataEl = $('#__NEXT_DATA__');
    if (nextDataEl.length > 0) {
      try {
        const raw = nextDataEl.html();
        JSON.parse(raw);
        if (hasJobStructures(JSON.parse(raw))) {
          console.log(`    Next.js __NEXT_DATA__ with job structures`);
        }
      } catch {}
      console.log(`    Found Next.js __NEXT_DATA__ hydration`);
      return {
        scraperType: 'Cheerio-Hydrated',
        extractionStrategy: 'JSON.parse(NEXT_DATA)',
        paradigm: 'Hydrated-JSON',
        urlPattern: baseUrl
      };
    }

    const scripts = $('script:not([src])');
    let hydrationType = '';

    for (let i = 0; i < scripts.length; i++) {
      const content = $(scripts[i]).html() || '';

      if (content.includes('self.__next_f') || content.includes('__NEXT_DATA__') || content.includes('__NEXT_LOADED_PAGES__')) {
        hydrationType = 'Next.js';
        break;
      }
      if (content.includes('window.__NUXT__') || content.includes('__NUXT_DATA__') || content.includes('__NUXT__')) {
        hydrationType = 'Nuxt';
        break;
      }
      if (content.includes('__remixContext') || content.includes('window.__remixManifest') || content.includes('window.__remixRouteModules')) {
        hydrationType = 'Remix';
        break;
      }
      if (content.includes('__INITIAL_STATE__') || content.includes('window.__DATA__') || content.includes('window.__PRELOADED_STATE__')) {
        hydrationType = 'Custom-Hydrated';
        break;
      }
      if (content.includes('window.__STATIC_DATA__') || content.includes('__GATSBY__')) {
        hydrationType = 'Gatsby';
        break;
      }
    }

    if (hydrationType) {
      console.log(`    Found ${hydrationType} hydration script`);
      return {
        scraperType: 'Cheerio-Hydrated',
        extractionStrategy: `Hydration-${hydrationType}`,
        paradigm: 'Hydrated-JSON',
        urlPattern: baseUrl
      };
    }

    const jsonLdScripts = $('script[type="application/ld+json"]');
    if (jsonLdScripts.length > 0) {
      console.log(`    Found ${jsonLdScripts.length} JSON-LD script(s)`);
      return {
        scraperType: 'Cheerio-Hydrated',
        extractionStrategy: 'JSON-LD',
        paradigm: 'Structured-Data',
        urlPattern: baseUrl
      };
    }

    console.log(`    No hydration markers detected`);
    return null;

  } catch (error) {
    const reason = error.code || error.message;
    console.log(`    Request failed: ${reason}`);
    return null;
  }
}

// ===== Tactic B: Playwright Stealth Pre-Flight =====
async function tacticBPlaywright(entry) {
  const domain = entry.domain;
  const baseUrl = entry.validatedUrl || entry.finalUrl || `https://${domain}`;

  console.log(`  [Tactic B] Playwright stealth for ${domain}...`);

  let browser;
  try {
    const { chromium } = require('playwright');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      bypassCSP: true,
      javaScriptEnabled: true
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    try {
      await page.goto(baseUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
    } catch (navError) {
      console.log(`    Navigation error: ${navError.message}`);
      await browser.close();
      return null;
    }

    await page.waitForTimeout(4000);

    const finalUrl = page.url();
    const pageTitle = await page.title();
    let html = '';
    try {
      html = await page.content();
    } catch {}

    const $ = cheerio.load(html || '');
    const bodyText = $('body').text().trim().substring(0, 500);

    const blockPatterns = [
      /access denied/i,
      /blocked/i,
      /captcha/i,
      /cloudflare/i,
      /checking your browser/i,
      /enable javascript/i,
      /just a moment/i,
      /ddos protection/i,
      /ray id:/i
    ];

    let isBlocked = false;
    for (const pattern of blockPatterns) {
      if (pattern.test(bodyText)) {
        isBlocked = true;
        break;
      }
    }

    await browser.close();

    if (isBlocked) {
      console.log(`    Still blocked (title: "${pageTitle.substring(0, 60)}")`);
      return null;
    }

    if (!html || html.length < 500) {
      console.log(`    Page too short (${html ? html.length : 0} bytes)`);
      return null;
    }

    console.log(`    Page loaded: ${html.length} bytes, title: "${pageTitle.substring(0, 50)}"`);

    const resolvedUrl = finalUrl && finalUrl !== 'about:blank' ? finalUrl : baseUrl;

    let urlPattern = `https://${domain}`;
    try {
      const parsed = new URL(resolvedUrl);
      if (parsed.hostname !== domain && parsed.hostname.includes(domain.replace(/^www\./, '').split('.')[0])) {
        urlPattern = `${parsed.protocol}//${parsed.hostname}`;
      } else if (parsed.hostname !== domain) {
        urlPattern = `${parsed.protocol}//${parsed.hostname}`;
      }
    } catch {}

    return {
      scraperType: 'Playwright-Stealth',
      paradigm: 'Stealth-Unlocked',
      urlPattern: urlPattern,
      validatedUrl: resolvedUrl,
      finalUrl: resolvedUrl,
      extractionStrategy: null
    };

  } catch (error) {
    console.log(`    Playwright error: ${error.message}`);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

// ===== Tactic C: Speculative API Sniffing =====
async function tacticCAPISniffing(entry) {
  const domain = entry.domain;

  let origin;
  try {
    const candidate = entry.validatedUrl || entry.finalUrl || `https://${domain}`;
    const parsed = new URL(candidate);
    origin = `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    origin = `https://${domain}`;
  }

  console.log(`  [Tactic C] API sniffing ${domain} at ${origin}...`);

  const apiEndpoints = [
    '/api/jobs',
    '/api/v1/jobs',
    '/api/v2/jobs',
    '/api/job-listings',
    '/api/positions',
    '/api/v1/search?q=react',
    '/api/search?q=react',
    '/api/v1/listings?q=react',
    '/api/v1/vacancies?q=react',
    '/jobs.json',
    '/api/jobs.json',
    '/api/public/jobs',
    '/api/v1/job/search?q=react',
    '/search.json?q=react',
    '/graphql'
  ];

  const sniffInstance = axios.create({
    timeout: 10000,
    maxRedirects: 3,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    validateStatus: (s) => s < 500
  });

  for (const endpoint of apiEndpoints) {
    const url = `${origin}${endpoint}`;
    if (!isValidUrl(url)) continue;

    try {
      let response;
      if (endpoint === '/graphql') {
        response = await sniffInstance.post(url, {
          query: '{ jobs { id title company location } }'
        }, { timeout: 8000 });
      } else {
        response = await sniffInstance.get(url);
      }

      if (response.status !== 200) continue;

      const contentType = (response.headers['content-type'] || '').toLowerCase();
      const data = response.data;

      if (contentType.includes('application/json') || contentType.includes('text/json') || contentType.includes('+json')) {
        const jsonData = typeof data === 'object' ? data : (() => {
          try { return JSON.parse(data); } catch { return null; }
        })();

        if (jsonData && hasJobStructures(jsonData)) {
          console.log(`    JSON API at: ${endpoint} (${JSON.stringify(data).length} bytes)`);
          return {
            scraperType: 'API-Direct',
            paradigm: 'API-Direct',
            urlPattern: url,
            extractionStrategy: 'Direct API Call'
          };
        }
        if (jsonData && typeof jsonData === 'object' && Object.keys(jsonData).length > 0) {
          console.log(`    JSON response at ${endpoint} but no job structures (keys: ${Object.keys(jsonData).slice(0, 5).join(', ')})`);
        }
      }

      if (typeof data === 'string' && (data.trim().startsWith('{') || data.trim().startsWith('['))) {
        try {
          const parsed = JSON.parse(data);
          if (parsed && hasJobStructures(parsed)) {
            console.log(`    JSON API at ${endpoint} (no content-type header)`);
            return {
              scraperType: 'API-Direct',
              paradigm: 'API-Direct',
              urlPattern: url,
              extractionStrategy: 'Direct API Call'
            };
          }
        } catch {}
      }

    } catch (error) {
      continue;
    }
  }

  console.log(`    No API endpoint found`);
  return null;
}

// ===== Target Classification =====
function isUnresolved(entry) {
  if (!entry) return false;

  if (entry.scraperType) return false;

  if (entry.urlPattern && entry.paradigm !== 'Not Found' && entry.paradigm !== 'Blocked' && entry.paradigm !== 'Failed') {
    return false;
  }

  return true;
}

function qualifiesForTacticA(entry) {
  const isTier2or3 = entry.tier && (entry.tier.includes('Tier 2') || entry.tier.includes('Tier 3'));
  const has200 = entry.statusCode === 200;
  const noValidPattern = !entry.urlPattern || entry.paradigm === 'Blocked' || entry.paradigm === 'Not Found';
  return isTier2or3 && has200 && noValidPattern;
}

function qualifiesForTacticB(entry) {
  const isTier4 = entry.tier && entry.tier.includes('Tier 4');
  return isTier4;
}

// ===== Main Runner =====
async function runUnlocker(options = {}) {
  const {
    skipPlaywright = false,
    skipApi = false,
    onlyDomain = null,
    dryRun = false
  } = options;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        URL Unlocker — Phase 2 Reconnaissance         ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const patterns = await readExistingPatterns();
  const entries = Object.entries(patterns);
  console.log(`Loaded ${entries.length} platform entries`);

  const unresolved = entries.filter(([, entry]) => {
    if (onlyDomain && entry.domain !== onlyDomain) return false;
    return isUnresolved(entry);
  });

  const skipped = entries.length - unresolved.length;
  console.log(`Already resolved: ${skipped}`);
  console.log(`Unresolved targets: ${unresolved.length}\n`);

  if (unresolved.length === 0) {
    console.log('All entries are resolved. Nothing to do.');
    return { total: 0, updated: 0 };
  }

  let updated = 0;

  for (let i = 0; i < unresolved.length; i++) {
    const [key, entry] = unresolved[i];
    const domain = entry.domain;

    console.log(`[${i + 1}/${unresolved.length}] ${domain}`);
    console.log(`    Tier: ${entry.tier} | Paradigm: ${entry.paradigm} | Status: ${entry.statusCode}`);

    let result = null;

    if (!dryRun) {
      if (qualifiesForTacticA(entry)) {
        result = await tacticAHydration(entry);
      }

      if (!result && qualifiesForTacticB(entry) && !skipPlaywright) {
        result = await tacticBPlaywright(entry);
      }

      if (!result && !skipApi) {
        result = await tacticCAPISniffing(entry);
      }
    } else {
      const tactic = qualifiesForTacticA(entry) ? 'Tactic A (Hydration)' :
                     qualifiesForTacticB(entry) ? 'Tactic B (Playwright)' :
                     'Tactic C (API)';
      console.log(`  [DRY-RUN] Would attempt ${tactic}`);
    }

    if (result) {
      const updates = {
        scraperType: result.scraperType,
        extractionStrategy: result.extractionStrategy,
        paradigm: result.paradigm,
        urlPattern: result.urlPattern || entry.urlPattern,
        validatedUrl: result.validatedUrl || entry.validatedUrl,
        finalUrl: result.finalUrl || entry.finalUrl,
        discoveredAt: new Date().toISOString()
      };

      if (entry.tier && entry.tier.includes('Tier 4') && result.scraperType) {
        updates.tier = 'Tier 2 (Challenged)';
      }

      if (!dryRun) {
        await updatePatternEntry(key, updates);
      }
      updated++;
      const tierUpdate = updates.tier ? ` → ${updates.tier}` : '';
      console.log(`    ✓ Unlocked: ${result.scraperType}${tierUpdate}\n`);
    } else {
      console.log(`    No unlock found\n`);
    }

    if (i < unresolved.length - 1) {
      await new Promise(resolve => setTimeout(resolve, POLITE_DELAY_MS));
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  if (dryRun) {
    console.log(`DRY RUN COMPLETE — ${updated}/${unresolved.length} would be updated`);
  } else {
    console.log(`UNLOCKER COMPLETE — ${updated}/${unresolved.length} entries updated`);
  }
  console.log('═══════════════════════════════════════════════════════\n');

  return { total: unresolved.length, updated };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    skipPlaywright: args.includes('--skip-playwright'),
    skipApi: args.includes('--skip-api'),
    onlyDomain: (() => {
      const idx = args.indexOf('--only');
      return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
    })(),
    dryRun: args.includes('--dry-run')
  };

  runUnlocker(options)
    .then(({ total, updated }) => {
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = {
  runUnlocker,
  tacticAHydration,
  tacticBPlaywright,
  tacticCAPISniffing,
  isUnresolved,
  qualifiesForTacticA,
  qualifiesForTacticB
};
