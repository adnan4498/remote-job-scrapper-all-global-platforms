'use strict';

const path = require('path');
// Safely load the .env file from the project root relative to this script's directory
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const axios = require('axios');
const fs = require('fs').promises;

const AGGREGATOR_CONFIG = {
  adzuna: {
    routingParadigm: 'subdomain',
    supportedRegions: ['gb', 'us', 'au', 'ca', 'de', 'fr', 'nl', 'ru', 'in', 'br', 'za', 'sg', 'pl', 'it', 'es'],
    urlTemplate: 'https://api.adzuna.com/v1/api/jobs/{region}/search/1',
    useApi: true
  },
  jooble: {
    routingParadigm: 'api_post',
    supportedRegions: 'near-global',
    urlTemplate: null,
    useApi: true
  },
  // ziprecruiter: {
  //   routingParadigm: 'path_segment',
  //   supportedRegions: ['us', 'uk', 'ca'],
  //   urlTemplate: 'https://www.ziprecruiter.com/jobs-search?search={keyword}&location={region}'
  // },
  // careerbuilder: {
  //   routingParadigm: 'path_segment',
  //   supportedRegions: ['us', 'uk', 'ca', 'in', 'fr', 'de'],
  //   urlTemplate: 'https://www.careerbuilder.com/{region}/jobs?q={keyword}'
  // },
  // monster: {
  //   routingParadigm: 'subdomain',
  //   supportedRegions: ['us', 'uk', 'ca', 'fr', 'de', 'in', 'ae', 'sa', 'qa', 'kw', 'bh', 'sg', 'hk', 'my', 'ph', 'ie', 'nl', 'be', 'lu', 'at', 'ch', 'se', 'no', 'dk', 'fi', 'it', 'es', 'pt', 'br', 'mx', 'ar', 'cl', 'co', 'pe'],
  //   urlTemplate: 'https://{region}.monster.com/jobs?q={keyword}'
  // }
};

const REGION_ACCEPT_LANG_MAP = {
  us: 'en-US', gb: 'en-GB', uk: 'en-GB', ca: 'en-CA', au: 'en-AU', nz: 'en-NZ',
  de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', br: 'pt-BR',
  nl: 'nl-NL', be: 'nl-BE', lu: 'fr-LU', at: 'de-AT', ch: 'de-CH',
  se: 'sv-SE', no: 'nb-NO', dk: 'da-DK', fi: 'fi-FI', is: 'is-IS',
  pl: 'pl-PL', cz: 'cs-CZ', sk: 'sk-SK', hu: 'hu-HU', ro: 'ro-RO', bg: 'bg-BG',
  hr: 'hr-HR', rs: 'sr-RS', lt: 'lt-LT', lv: 'lv-LV', ee: 'et-EE',
  ru: 'ru-RU', ua: 'uk-UA',
  gr: 'el-GR', cy: 'el-CY', tr: 'tr-TR',
  il: 'he-IL', ae: 'ar-AE', sa: 'ar-SA', qa: 'ar-QA', kw: 'ar-KW', bh: 'ar-BH', om: 'ar-OM', eg: 'ar-EG', jo: 'ar-JO', lb: 'ar-LB',
  pk: 'en-PK', in: 'en-IN', sg: 'en-SG', my: 'en-MY', ph: 'en-PH', hk: 'zh-HK',
  id: 'id-ID', th: 'th-TH', vn: 'vi-VN',
  jp: 'ja-JP', kr: 'ko-KR', cn: 'zh-CN', tw: 'zh-TW',
  mx: 'es-MX', ar: 'es-AR', cl: 'es-CL', co: 'es-CO', pe: 'es-PE', cr: 'es-CR', pa: 'es-PA', uy: 'es-UY', ve: 'es-VE', ec: 'es-EC',
  za: 'en-ZA', ng: 'en-NG', ke: 'en-KE',
  ie: 'en-IE'
};

const REGIONS = Object.keys(REGION_ACCEPT_LANG_MAP);
const KEYWORDS = ['react', 'node js'];

// Fixed double 'src' path compilation error
const OUTPUT_FILE = path.resolve(__dirname, '..', 'config', 'aggregator-test-results.json');

function getAcceptLang(region) {
  return REGION_ACCEPT_LANG_MAP[region] || 'en-US,en;q=0.9';
}

function buildUrl(aggregator, config, region, keyword) {
  if (config.useApi) return null;

  let url = config.urlTemplate
    .replace(/{region}/g, region)
    .replace(/{keyword}/g, encodeURIComponent(keyword));

  if (config.routingParadigm === 'path_segment') {
    url = url.replace(/{region}/g, region);
  }

  return url;
}

function buildAxiosInstance(region) {
  return axios.create({
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': `${getAcceptLang(region)},en;q=0.9`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cache-Control': 'max-age=0'
    },
    validateStatus: () => true
  });
}

function detectRedirectToHomepage(initialUrl, finalUrl, region) {
  if (!finalUrl || finalUrl === initialUrl) return false;

  try {
    const finalParsed = new URL(finalUrl);
    const hostname = finalParsed.hostname.toLowerCase();
    const pathname = finalParsed.pathname.toLowerCase();

    if (!hostname.includes(region) && !pathname.includes(`/${region}/`) && !pathname.includes(`/${region}`)) {
      if (pathname === '/' || pathname.length < 3 || pathname.includes('/home') || pathname.includes('/index')) {
        return true;
      }
    }

    if (hostname.startsWith('www.') && !hostname.includes(region)) {
      const regionSubdomain = `${region}.`;
      if (!hostname.startsWith(regionSubdomain)) {
        return true;
      }
    }
  } catch {}

  return false;
}

async function testAdzuna(region, keyword) {
  const appId = process.env.ADZUNA_APP_ID;
  // Fallback checks both variable name variants to prevent env loading gaps
  const apiKey = process.env.ADZUNA_API_KEY || process.env.ADZUNA_APP_KEY;
  if (!appId || !apiKey) return 'SKIP_NO_API_KEYS';

  const url = `https://api.adzuna.com/v1/api/jobs/${region}/search/1?app_id=${appId}&app_key=${apiKey}&what=${encodeURIComponent(keyword)}&results_per_page=20&content-type=application/json`;

  try {
    const res = await axios.get(url, { timeout: 15000, headers: { 'Accept': 'application/json' } });
    if (res.status === 200 && res.data && Array.isArray(res.data.results)) {
      const count = res.data.results.length;
      return count > 0 ? `SUCCESS (${count} jobs)` : `EMPTY_200 (0 jobs)`;
    }
    return `HTTP_${res.status}`;
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'NXDOMAIN';
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return 'TIMEOUT';
    if (err.response) return `HTTP_${err.response.status}`;
    return `ERROR_${err.code || err.message.substring(0, 30)}`;
  }
}

async function testJooble(region, keyword) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return 'SKIP_NO_API_KEYS';

  const regionNames = {
    us: 'United States', gb: 'United Kingdom', uk: 'United Kingdom', ca: 'Canada',
    au: 'Australia', nz: 'New Zealand', de: 'Germany', fr: 'France', es: 'Spain',
    it: 'Italy', pt: 'Portugal', br: 'Brazil', nl: 'Netherlands', be: 'Belgium',
    lu: 'Luxembourg', at: 'Austria', ch: 'Switzerland', se: 'Sweden', no: 'Norway',
    dk: 'Denmark', fi: 'Finland', is: 'Iceland', pl: 'Poland', cz: 'Czech Republic',
    sk: 'Slovakia', hu: 'Hungary', ro: 'Romania', bg: 'Bulgaria', hr: 'Croatia',
    rs: 'Serbia', lt: 'Lithuania', lv: 'Latvia', ee: 'Estonia', ru: 'Russia',
    ua: 'Ukraine', gr: 'Greece', cy: 'Cyprus', tr: 'Turkey', il: 'Israel',
    ae: 'United Arab Emirates', sa: 'Saudi Arabia', qa: 'Qatar', kw: 'Kuwait',
    bh: 'Bahrain', om: 'Oman', eg: 'Egypt', jo: 'Jordan', lb: 'Lebanon',
    pk: 'Pakistan', in: 'India', sg: 'Singapore', my: 'Malaysia', ph: 'Philippines',
    hk: 'Hong Kong', id: 'Indonesia', th: 'Thailand', vn: 'Vietnam',
    jp: 'Japan', kr: 'South Korea', cn: 'China', tw: 'Taiwan',
    mx: 'Mexico', ar: 'Argentina', cl: 'Chile', co: 'Colombia', pe: 'Peru',
    cr: 'Costa Rica', pa: 'Panama', uy: 'Uruguay', ve: 'Venezuela', ec: 'Ecuador',
    za: 'South Africa', ng: 'Nigeria', ke: 'Kenya', ie: 'Ireland'
  };

  const locationName = regionNames[region] || region.toUpperCase();

  try {
    const res = await axios.post(
      'https://jooble.org/api/' + apiKey,
      { keywords: keyword, location: locationName },
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );
    if (res.status === 200 && res.data && Array.isArray(res.data.jobs)) {
      const count = res.data.jobs.length;
      return count > 0 ? `SUCCESS (${count} jobs)` : `EMPTY_200 (0 jobs)`;
    }
    return `HTTP_${res.status}`;
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'NXDOMAIN';
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return 'TIMEOUT';
    if (err.response) return `HTTP_${err.response.status}`;
    return `ERROR_${err.code || err.message.substring(0, 30)}`;
  }
}

async function testHttpAggregator(aggregator, config, region, keyword) {
  const url = buildUrl(aggregator, config, region, keyword);
  if (!url) return 'SKIP_NO_URL_TEMPLATE';

  const instance = buildAxiosInstance(region);

  try {
    const res = await instance.get(url);
    const finalUrl = res.request?.res?.responseUrl || url;

    if (res.status === 403) return 'HTTP_403';
    if (res.status === 404) return 'HTTP_404';
    if (res.status === 429) return 'HTTP_429';
    if (res.status >= 500) return `HTTP_${res.status}`;

    if (res.status === 200) {
      if (detectRedirectToHomepage(url, finalUrl, region)) {
        return `REDIRECT_TO_HOMEPAGE_FAIL (→${finalUrl.substring(0, 60)})`;
      }

      const body = typeof res.data === 'string' ? res.data : String(res.data || '');
      const jobIndicators = [
        /job-listing/i, /job-card/i, /job-item/i, /vacancy/i,
        /class="job/i, /class='job/i, /data-testid="job/i,
        /search-result/i, /result-card/i, /position/i,
        /job-title/i, /company-name/i
      ];
      let hasJobs = false;
      for (const pattern of jobIndicators) {
        if (pattern.test(body)) { hasJobs = true; break; }
      }

      if (body.length < 1000 && !hasJobs) return 'EMPTY_PAGE';
      if (!hasJobs && body.length < 5000) return 'NO_JOB_MARKERS';
      return `SUCCESS (~${body.length} bytes)`;
    }

    return `HTTP_${res.status}`;
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'NXDOMAIN';
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return 'TIMEOUT';
    if (err.code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
    if (err.response) return `HTTP_${err.response.status}`;
    return `ERROR_${err.code || err.message.substring(0, 30)}`;
  }
}

async function testAggregator(aggregator, config, region, keyword) {
  if (config.supportedRegions !== 'near-global') {
    if (Array.isArray(config.supportedRegions) && !config.supportedRegions.includes(region)) {
      return 'SKIP_UNSUPPORTED';
    }
  }

  if (aggregator === 'adzuna') return testAdzuna(region, keyword);
  if (aggregator === 'jooble') return testJooble(region, keyword);
  return testHttpAggregator(aggregator, config, region, keyword);
}

async function run() {
  console.log('=== Aggregator Regional Matrix Test ===\n');
  
  // Debug verifying loaded keys prior to firing requests
  console.log('=== Environment Key Verification ===');
  console.log('ADZUNA_APP_ID Status:', !!process.env.ADZUNA_APP_ID);
  console.log('ADZUNA_API_KEY Status:', !!(process.env.ADZUNA_API_KEY || process.env.ADZUNA_APP_KEY));
  console.log('JOOBLE_API_KEY Status:', !!process.env.JOOBLE_API_KEY);
  console.log('====================================\n');

  console.log(`Aggregators: ${Object.keys(AGGREGATOR_CONFIG).join(', ')}`);
  console.log(`Regions: ${REGIONS.length}`);
  console.log(`Keywords: ${KEYWORDS.join(', ')}`);
  console.log(`Total tests: ${Object.keys(AGGREGATOR_CONFIG).length * REGIONS.length * KEYWORDS.length}\n`);

  const results = {};

  for (const [aggregator, config] of Object.entries(AGGREGATOR_CONFIG)) {
    results[aggregator] = {};
  }

  let total = 0;
  let completed = 0;
  const totalTests = Object.keys(AGGREGATOR_CONFIG).length * REGIONS.length * KEYWORDS.length;

  for (const [aggregator, config] of Object.entries(AGGREGATOR_CONFIG)) {
    for (const region of REGIONS) {
      results[aggregator][region] = {};

      for (const keyword of KEYWORDS) {
        total++;

        const isSupported = config.supportedRegions === 'near-global' ||
          (Array.isArray(config.supportedRegions) && config.supportedRegions.includes(region));

        if (!isSupported) {
          results[aggregator][region][keyword] = 'SKIP_UNSUPPORTED';
          completed++;
          console.log(`[${completed}/${totalTests}] ${aggregator} | ${region} | ${keyword} → SKIP_UNSUPPORTED`);
          continue;
        }

        const status = await testAggregator(aggregator, config, region, keyword);
        results[aggregator][region][keyword] = status;
        completed++;

        const shortStatus = status.length > 50 ? status.substring(0, 47) + '...' : status;
        console.log(`[${completed}/${totalTests}] ${aggregator} | ${region} | ${keyword} → ${shortStatus}`);

        if (completed < totalTests) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  // Ensure target directory exists prior to running write payloads to mitigate ENOENT errors
  const outputDir = path.dirname(OUTPUT_FILE);
  await fs.mkdir(outputDir, { recursive: true });

  const tempFile = `${OUTPUT_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(results, null, 2), 'utf-8');
  try {
    await fs.rename(tempFile, OUTPUT_FILE);
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOENT') {
      await fs.copyFile(tempFile, OUTPUT_FILE);
      await fs.unlink(tempFile);
    } else { throw e; }
  }

  const summary = {};
  for (const [agg, regions] of Object.entries(results)) {
    summary[agg] = { total: 0, success: 0, empty: 0, redirect: 0, skip: 0, error: 0, other: 0 };
    for (const [region, keywords] of Object.entries(regions)) {
      for (const [kw, status] of Object.entries(keywords)) {
        summary[agg].total++;
        if (status.startsWith('SUCCESS')) summary[agg].success++;
        else if (status.startsWith('EMPTY_200')) summary[agg].empty++;
        else if (status.startsWith('REDIRECT_TO_HOMEPAGE')) summary[agg].redirect++;
        else if (status === 'SKIP_UNSUPPORTED') summary[agg].skip++;
        else if (status.startsWith('HTTP_') || status.startsWith('ERROR_') || status === 'NXDOMAIN' || status === 'TIMEOUT') summary[agg].error++;
        else summary[agg].other++;
      }
    }
  }

  console.log('\n=== Summary ===');
  for (const [agg, s] of Object.entries(summary)) {
    console.log(`${agg}: ${s.total} tests | ${s.success} success | ${s.empty} empty | ${s.redirect} redirect | ${s.skip} skip | ${s.error} error | ${s.other} other`);
  }

  console.log(`\nResults written to: ${OUTPUT_FILE}`);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });