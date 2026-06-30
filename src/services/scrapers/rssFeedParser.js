const Parser = require('rss-parser');
const { decodeHtml } = require('./utils');
const { feedPlatforms } = require('../../config/platforms');

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

const RSS_PLATFORMS = feedPlatforms.filter((p) => p.type === 'rss');

function parseTitleMeta(item) {
  const title = (item.title || '').trim();
  if (!title) return { company: 'Unknown', jobTitle: 'Unknown Position' };

  const atIndex = title.lastIndexOf(' at ');
  if (atIndex > 0) {
    return {
      company: decodeHtml(title.substring(atIndex + 4).trim()),
      jobTitle: decodeHtml(title.substring(0, atIndex).trim()),
    };
  }

  const dashIndex = title.lastIndexOf(' - ');
  if (dashIndex > 0) {
    return {
      company: decodeHtml(title.substring(dashIndex + 3).trim()),
      jobTitle: decodeHtml(title.substring(0, dashIndex).trim()),
    };
  }

  const colonIndex = title.lastIndexOf(': ');
  if (colonIndex > 0) {
    return {
      company: decodeHtml(title.substring(colonIndex + 2).trim()),
      jobTitle: decodeHtml(title.substring(0, colonIndex).trim()),
    };
  }

  return { company: 'Unknown', jobTitle: decodeHtml(title) };
}

function extractRegion(item) {
  const content = item.content || item.contentSnippet || '';
  const summary = item.summary || (item.itunes && item.itunes.summary) || '';

  const patterns = [
    /Region[:\s]*([^<\n]+)/i,
    /Location[:\s]*([^<\n]+)/i,
    /Remote[:\s]*in[:\s]*([^<\n]+)/i,
    /<strong>Location<\/strong>[:\s]*([^<]+)/i,
    /<strong>Region<\/strong>[:\s]*([^<]+)/i,
  ];

  for (const text of [content, summary]) {
    if (!text) continue;
    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      if (match) {
        const region = match[1].replace(/<[^>]+>/g, '').trim();
        if (region && region !== 'Remote') return region;
      }
    }
  }

  return 'Remote';
}

function buildSlug(jobTitle, company) {
  return `${jobTitle} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeJob(jobTitle, company, link, region, platformSource) {
  return {
    title: jobTitle,
    company,
    url: decodeHtml(link),
    region: region || 'Remote',
    platformSource,
    slug: buildSlug(jobTitle, company),
    scrapedAt: new Date(),
  };
}

async function fetchPlatform(platform) {
  console.log(`[RSS] Fetching from ${platform.name}: ${platform.url}`);
  const feed = await parser.parseURL(platform.url);
  const jobs = [];

  for (const item of feed.items || []) {
    try {
      if (!item.link || !item.title) continue;
      const { company, jobTitle } = parseTitleMeta(item);
      const region = extractRegion(item);
      jobs.push(normalizeJob(jobTitle, company, item.link, region, platform.source));
    } catch (err) {
      console.error(`[RSS] ${platform.name}: Failed to parse item: ${err.message}`);
    }
  }

  console.log(`[RSS] ${platform.name}: Fetched ${jobs.length} jobs`);
  return jobs;
}

async function fetchJobs() {
  const allJobs = [];

  for (const platform of RSS_PLATFORMS) {
    try {
      const jobs = await fetchPlatform(platform);
      allJobs.push(...jobs);
    } catch (err) {
      console.error(`[RSS] Platform "${platform.name}" failed: ${err.message}`);
    }
  }

  console.log(`[RSS] Total jobs from all RSS platforms: ${allJobs.length}`);
  return allJobs;
}

module.exports = { fetchJobs };
