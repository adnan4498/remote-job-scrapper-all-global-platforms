'use strict';

const cheerio = require('cheerio');
const { playwrightPlatforms, aggregatorConfig } = require('../../config/platforms');
const { logBatchEntry } = require('../../../scripts/lib/logger');

const CONCURRENCY_LIMIT = 3;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function buildJob(title, company, url, region, source) {
  return {
    title: (title || 'Unknown Position').trim().substring(0, 300),
    company: (company || 'Unknown Company').trim().substring(0, 200),
    url: (url || '').trim(),
    region: (region || 'Remote').trim().substring(0, 200),
    platformSource: source,
    slug: buildSlug(title, company),
    scrapedAt: new Date()
  };
}

function extractJobsFromHtml(html, platformName, region) {
  const $ = cheerio.load(html);
  const jobs = [];

  const selectors = [
    '.job-card', '.job-listing', '.job-item',
    '[class*="job-card"]', '[class*="job-listing"]', '[class*="job-item"]',
    '.vacancy', '.vacancy-card', '.position', '.position-card',
    '.posting', '.posting-item', '.listing-item', '.list-item',
    'article[class*="job"]', 'li[class*="job"]',
    '[data-testid*="job"]', '[data-cy*="job"]',
    '.result', '.results-item', '.serp-item', '.search-result',
    '.opportunity', '.career-item',
    '[class*="job-card-"]', '[class*="JobCard-"]',
    '.card', '[class*="Card"]'
  ];

  for (const selector of selectors) {
    try {
      const elements = $(selector);
      if (elements.length >= 1 && elements.length < 500) {
        elements.each((i, el) => {
          const jobEl = $(el);
          const titleEl = jobEl.find('h2, h3, h4, h5, .title, .job-title, [class*="title"], a').first();
          const title = titleEl.text().trim() || jobEl.text().trim().substring(0, 100);

          const companyEl = jobEl.find('.company, .employer, .org, [class*="company"], [class*="employer"]').first();
          const company = companyEl.text().trim();

          const linkEl = jobEl.find('a[href]').first();
          const link = linkEl.attr('href') || '';

          if (!title || title.length < 3) return;

          let fullUrl = link || '';
          if (fullUrl && !fullUrl.startsWith('http')) {
            try {
              const baseHost = platformName.toLowerCase().replace(/\s+/g, '') + '.com';
              fullUrl = new URL(fullUrl, `https://${baseHost}`).toString();
            } catch {}
          }

          jobs.push(buildJob(title, company, fullUrl, region, `Playwright (${platformName})`));
        });
        break;
      }
    } catch {}
  }

  if (jobs.length === 0) {
    const $links = $('a[href]');
    $links.each((i, el) => {
      if (i >= 60) return false;
      const text = $(el).text().trim();
      if (text.length >= 8 && text.length <= 120) {
        jobs.push(buildJob(text, 'Unknown', $(el).attr('href') || '', region, `Playwright (${platformName})`));
      }
    });
  }

  return jobs;
}

async function scrapePlatformPage(platform, region, keyword, browserContext) {
  const { chromium } = require('playwright');
  const { name, url, scope } = platform;
  const regionLabel = region === 'global' ? 'global' : region;

  let pageUrl = url;
  let page;

  try {
    page = await browserContext.newPage();

    await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 25000
    });

    await page.waitForTimeout(4000);

    try {
      await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' }));
      await page.waitForTimeout(500);
    } catch {}

    const html = await page.content();
    const jobs = extractJobsFromHtml(html, name, regionLabel);

    console.log(`[PW] ${name} (${regionLabel}/${keyword}): ${jobs.length} jobs`);
    logBatchEntry(`Playwright (${name})`, regionLabel, keyword, jobs.length);

    return jobs;

  } catch (err) {
    console.error(`[PW] ${name} (${regionLabel}/${keyword}) failed: ${err.message}`);
    logBatchEntry(`Playwright (${name})`, regionLabel, keyword, 0);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function scrapeAllPlatforms() {
  const allJobs = [];
  const { keywords } = aggregatorConfig;

  const { chromium } = require('playwright');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });

  try {
    const globalContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      bypassCSP: true,
      javaScriptEnabled: true
    });

    await globalContext.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    try {
      for (const platform of playwrightPlatforms) {
        const tasks = [];

        const regions = platform.scope === 'global' ? ['global'] :
                       platform.scope === 'us' ? ['us'] :
                       platform.scope === 'uk' ? ['uk'] :
                       aggregatorConfig.regions;

        for (const region of regions) {
          for (const keyword of keywords) {
            tasks.push({ platform, region: region === 'global' ? 'global' : region, keyword });

            if (tasks.length >= CONCURRENCY_LIMIT) {
              const batchResults = await Promise.allSettled(
                tasks.map(task => scrapePlatformPage(task.platform, task.region, task.keyword, globalContext))
              );

              for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                  allJobs.push(...result.value);
                }
              }

              tasks.length = 0;
            }
          }
        }

        if (tasks.length > 0) {
          const batchResults = await Promise.allSettled(
            tasks.map(task => scrapePlatformPage(task.platform, task.region, task.keyword, globalContext))
          );

          for (const result of batchResults) {
            if (result.status === 'fulfilled') {
              allJobs.push(...result.value);
            }
          }
        }

        console.log(`[PW] ${platform.name} complete: ${allJobs.length} total collected`);
      }
    } finally {
      await globalContext.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`[PW] Total jobs from all playwright platforms: ${allJobs.length}`);
  return allJobs;
}

async function fetchJobs() {
  try {
    return await scrapeAllPlatforms();
  } catch (err) {
    console.error(`[PW] Playwright pipeline failed: ${err.message}`);
    return [];
  }
}

module.exports = { fetchJobs };
