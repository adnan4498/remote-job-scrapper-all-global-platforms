'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { fetchWithRetry } = require('./utils');
const { cheerioPlatforms, aggregatorConfig } = require('../../config/platforms');
const { logBatchEntry } = require('../../../scripts/lib/logger');

const axiosInstance = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br'
  },
  validateStatus: (s) => s < 500
});

const GENERIC_SELECTORS = [
  '.job-card', '.job-listing', '.job-item',
  '[class*="job-card"]', '[class*="job-listing"]', '[class*="job-item"]',
  '.vacancy', '.vacancy-card', '.position', '.position-card',
  '.posting', '.posting-item', '.listing-item', '.list-item',
  'article[class*="job"]', 'li[class*="job"]', 'div[class*="job"]',
  '[data-testid*="job"]', '[data-cy*="job"]',
  '.result', '.results-item', '.serp-item', '.search-result',
  '.opportunity', '.career-item', '[class*="search-result"]',
  '.hits-item', '.hit', '[class*="hit-item"]',
  '[class*="job-card-"]', '[class*="JobCard-"]'
];

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

  for (const selector of GENERIC_SELECTORS) {
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

          let fullUrl = link;
          if (link && !link.startsWith('http')) {
            try {
              fullUrl = new URL(link, `https://${platformName.replace(/\s+/g, '').toLowerCase()}.com`).toString();
            } catch {
              fullUrl = link;
            }
          }

          jobs.push(buildJob(title, company, fullUrl, region, `Cheerio (${platformName})`));
        });
        break;
      }
    } catch {}
  }

  if (jobs.length === 0) {
    const bodyText = $('body').text().trim();
    if (bodyText.length > 200) {
      const titleCandidates = [];
      $('h2, h3, h4, a[href]').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length >= 10 && text.length <= 120) {
          titleCandidates.push({
            title: text,
            url: $(el).attr('href') || ''
          });
        }
      });

      for (const candidate of titleCandidates.slice(0, 50)) {
        let fullUrl = candidate.url;
        if (fullUrl && !fullUrl.startsWith('http')) {
          try {
            fullUrl = new URL(fullUrl, `https://${platformName.replace(/\s+/g, '').toLowerCase()}.com`).toString();
          } catch {
            fullUrl = candidate.url;
          }
        }
        jobs.push(buildJob(candidate.title, 'Unknown', fullUrl, region, `Cheerio (${platformName})`));
      }
    }
  }

  return jobs;
}

function resolveRegions(scope) {
  const { regions } = aggregatorConfig;
  if (scope === 'global') return ['global'];
  if (scope === 'us') return ['us'];
  if (scope === 'uk') return ['uk'];
  return regions;
}

async function fetchPlatform(platform) {
  const { name, url, scope } = platform;
  const regions = resolveRegions(scope);
  const { keywords } = aggregatorConfig;
  const allJobs = [];

  for (const region of regions) {
    for (const keyword of keywords) {
      let pageUrl = url;
      let regionLabel = region;

      if (region === 'global') {
        regionLabel = 'global';
      }

      if (region !== 'global' && url.includes('remote-jobs') === false) {
        pageUrl = url.replace(/\/$/, '') + '/' + region;
      }

      try {
        console.log(`[CHEERIO] ${name} (${regionLabel}/${keyword}) -> ${pageUrl}`);
        const response = await fetchWithRetry(
          () => axiosInstance.get(pageUrl),
          `Cheerio/${name}/${regionLabel}/${keyword}`
        );

        if (response.status !== 200) {
          logBatchEntry(`Cheerio (${name})`, regionLabel, keyword, 0);
          continue;
        }

        const html = typeof response.data === 'string' ? response.data : String(response.data || '');
        const jobs = extractJobsFromHtml(html, name, regionLabel);

        allJobs.push(...jobs);
        logBatchEntry(`Cheerio (${name})`, regionLabel, keyword, jobs.length);
        console.log(`[CHEERIO] ${name} (${regionLabel}/${keyword}): ${jobs.length} jobs`);

      } catch (err) {
        console.error(`[CHEERIO] ${name} (${regionLabel}/${keyword}) failed: ${err.message}`);
        logBatchEntry(`Cheerio (${name})`, regionLabel, keyword, 0);
      }
    }
  }

  return allJobs;
}

async function fetchJobs() {
  const allJobs = [];

  for (const platform of cheerioPlatforms) {
    try {
      const jobs = await fetchPlatform(platform);
      allJobs.push(...jobs);
      console.log(`[CHEERIO] ${platform.name} total: ${jobs.length} jobs`);
    } catch (err) {
      console.error(`[CHEERIO] Platform "${platform.name}" failed: ${err.message}`);
    }
  }

  console.log(`[CHEERIO] Total jobs from all cheerio platforms: ${allJobs.length}`);
  return allJobs;
}

module.exports = { fetchJobs };
