'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { fetchWithRetry } = require('./utils');
const { protectedPlatforms, aggregatorConfig } = require('../../config/platforms');
const { compileMatrixUrl } = require('../../../scripts/lib/matrix-compiler');
const { readExistingPatterns } = require('../../../scripts/lib/result-writer');
const { logBatchEntry } = require('../../../scripts/lib/logger');

const JITTER_MIN_MS = 6000;
const JITTER_MAX_MS = 10000;

const GENERIC_SELECTORS = [
  '.job-card', '.job-listing', '.job-item',
  '[class*="job-card"]', '[class*="job-listing"]', '[class*="job-item"]',
  '.vacancy', '.vacancy-card', '.position', '.position-card',
  '.posting', '.posting-item', '.listing-item', '.list-item',
  'article[class*="job"]', 'li[class*="job"]', 'div[class*="job"]',
  '[data-testid*="job"]', '[data-cy*="job"]',
  '.result', '.results-item', '.serp-item', '.search-result',
  '.opportunity', '.career-item',
  '[class*="job-card-"]', '[class*="JobCard-"]',
  '[data-automation*="jobCard"]', '[data-automation*="searchResult"]'
];

function buildSlug(title, company, url) {
  const base = `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 160);
  const urlHash = (url || '').trim().substring(0, 60).replace(/[^a-z0-9]+/g, '').toLowerCase();
  return `${base}-${urlHash}`.substring(0, 200).replace(/-+$/g, '');
}

function buildJob(title, company, url, region, source) {
  return {
    title: (title || 'Unknown Position').trim().substring(0, 300),
    company: (company || 'Unknown Company').trim().substring(0, 200),
    url: (url || '').trim(),
    region: (region || 'Remote').trim().substring(0, 200),
    platformSource: source,
    slug: buildSlug(title, company, url),
    scrapedAt: new Date()
  };
}

function randomJitter(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function extractJobsFromHtml(html, platformName, region) {
  const $ = cheerio.load(html);
  const jobs = [];

  for (const selector of GENERIC_SELECTORS) {
    try {
      const elements = $(selector);
      if (elements.length >= 1 && elements.length < 500) {
        elements.each((i, el) => {
          if (jobs.length >= 500) return false;
          const jobEl = $(el);
          const titleEl = jobEl.find('h2, h3, h4, .title, .job-title, [class*="title"], a').first();
          const title = titleEl.text().trim() || jobEl.text().trim().substring(0, 100);

          const companyEl = jobEl.find('.company, .employer, .org, [class*="company"]').first();
          const company = companyEl.text().trim();

          const linkEl = jobEl.find('a[href]').first();
          const link = linkEl.attr('href') || '';

          if (!title || title.length < 3) return;

          let fullUrl = link || '';
          if (fullUrl && !fullUrl.startsWith('http')) {
            try {
              fullUrl = new URL(fullUrl, `https://${platformName.replace(/\s+/g, '').toLowerCase()}.com`).toString();
            } catch {}
          }

          jobs.push(buildJob(title, company, fullUrl, region, `Protected (${platformName})`));
        });
        break;
      }
    } catch {}
  }

  if (jobs.length === 0) {
    const $body = $('body');
    const bodyText = $body.text().trim();
    if (bodyText.length > 200) {
      $('h2, h3, h4, a[href]').each((i, el) => {
        if (jobs.length >= 200) return false;
        const text = $(el).text().trim();
        if (text.length >= 8 && text.length <= 120) {
          const link = $(el).attr('href') || '';
          jobs.push(buildJob(text, 'Unknown', link, region, `Protected (${platformName})`));
        }
      });
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

async function getUrlForPlatform(platformName, baseUrl, region, keyword) {
  const patterns = await readExistingPatterns();
  const platformKey = platformName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const entry = patterns[platformKey];
  if (entry && entry.urlPattern) {
    return compileMatrixUrl(entry, keyword, region);
  }

  if (platformName === 'Indeed') {
    const subdomains = ['www', 'uk', 'ca', 'pk'];
    const sub = region === 'global' ? 'www' : (subdomains.includes(region) ? region : 'www');
    return `https://${sub}.${baseUrl}/jobs?q=${encodeURIComponent(keyword)}`;
  }

  if (platformName === 'Dice') {
    const sub = region === 'global' ? 'www' : region;
    return `https://${sub}.${baseUrl}/jobs?q=${encodeURIComponent(keyword)}`;
  }

  if (platformName === 'Monster') {
    const sub = region === 'global' ? 'www' : region;
    return `https://${sub}.${baseUrl}/jobs?q=${encodeURIComponent(keyword)}`;
  }

  if (platformName === 'CareerBuilder') {
    return `https://${baseUrl}/${region}/jobs?q=${encodeURIComponent(keyword)}`;
  }

  if (platformName === 'ZipRecruiter') {
    return `https://${baseUrl}/jobs?q=${encodeURIComponent(keyword)}&location=${region}`;
  }

  if (platformName === 'Glassdoor') {
    return `https://${baseUrl}/Job/${region}-jobs-SRCH_KO0,${keyword.length}.htm?keyword=${encodeURIComponent(keyword)}`;
  }

  if (platformName === 'Built In') {
    return `https://${baseUrl}/jobs?q=${encodeURIComponent(keyword)}&location=${region}`;
  }

  return `https://${baseUrl}/${region}/jobs?q=${encodeURIComponent(keyword)}`;
}

async function executeTask(platform, region, keyword, axiosInstance) {
  const { name, baseUrl } = platform;
  const regionLabel = region === 'global' ? 'global' : region;

  try {
    const pageUrl = await getUrlForPlatform(name, baseUrl, regionLabel, keyword);

    console.log(`[PROTECTED] ${name} (${regionLabel}/${keyword}) -> ${pageUrl}`);

    const response = await fetchWithRetry(
      () => axiosInstance.get(pageUrl),
      `Protected/${name}/${regionLabel}/${keyword}`
    );

    if (response.status === 403 || response.status === 429) {
      console.log(`[PROTECTED] ${name} (${regionLabel}/${keyword}): Blocked (${response.status})`);
      logBatchEntry(`Protected (${name})`, regionLabel, keyword, 0);
      return [];
    }

    if (response.status !== 200) {
      logBatchEntry(`Protected (${name})`, regionLabel, keyword, 0);
      return [];
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data || '');

    const blockedPatterns = [
      /access denied/i, /blocked/i, /captcha/i, /cloudflare/i,
      /checking your browser/i, /just a moment/i
    ];

    let isBlocked = false;
    for (const pattern of blockedPatterns) {
      if (pattern.test(html.substring(0, 2000))) {
        isBlocked = true;
        break;
      }
    }

    if (isBlocked) {
      console.log(`[PROTECTED] ${name} (${regionLabel}/${keyword}): Soft block detected`);
      logBatchEntry(`Protected (${name})`, regionLabel, keyword, 0);
      return [];
    }

    const jobs = extractJobsFromHtml(html, name, regionLabel);
    logBatchEntry(`Protected (${name})`, regionLabel, keyword, jobs.length);
    console.log(`[PROTECTED] ${name} (${regionLabel}/${keyword}): ${jobs.length} jobs`);

    return jobs;

  } catch (err) {
    console.error(`[PROTECTED] ${name} (${regionLabel}/${keyword}) failed: ${err.message}`);
    logBatchEntry(`Protected (${name})`, regionLabel, keyword, 0);
    return [];
  }
}

function buildTaskQueue(platforms, keywords, regionsResolver) {
  const tasks = [];

  for (const platform of platforms) {
    const regions = regionsResolver(platform.scope);
    for (const region of regions) {
      for (const keyword of keywords) {
        tasks.push({
          platform,
          region: region === 'global' ? 'global' : region,
          keyword
        });
      }
    }
  }

  return tasks;
}

async function fetchJobs() {
  const allJobs = [];
  const { keywords } = aggregatorConfig;

  const tasks = buildTaskQueue(protectedPlatforms, keywords, resolveRegions);
  const shuffled = shuffleArray(tasks);

  console.log(`[PROTECTED] ${shuffled.length} tasks across ${protectedPlatforms.length} platforms (shuffled)`);

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

  for (let i = 0; i < shuffled.length; i++) {
    const { platform, region, keyword } = shuffled[i];
    const jobs = await executeTask(platform, region, keyword, axiosInstance);
    allJobs.push(...jobs);

    if (i < shuffled.length - 1) {
      const delay = randomJitter(JITTER_MIN_MS, JITTER_MAX_MS);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const perPlatform = {};
  for (const job of allJobs) {
    const key = job.platformSource;
    perPlatform[key] = (perPlatform[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(perPlatform)) {
    console.log(`[PROTECTED] ${k} total: ${v} jobs`);
  }

  console.log(`[PROTECTED] Total jobs from all protected platforms: ${allJobs.length}`);
  return allJobs;
}

module.exports = { fetchJobs };
