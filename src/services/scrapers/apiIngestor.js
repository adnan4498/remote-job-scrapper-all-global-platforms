const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { feedPlatforms } = require('../../config/platforms');

const JSON_PLATFORMS = feedPlatforms.filter((p) => p.type === 'json');

const axiosInstance = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json',
  },
});

function buildSlug(position, company) {
  return `${position} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function buildNormalizedJob(title, company, url, location, platformSource) {
  return {
    title: (title || 'Unknown Position').trim().substring(0, 300),
    company: (company || 'Unknown Company').trim().substring(0, 200),
    url: (url || '').trim(),
    region: (location || 'Remote').trim().substring(0, 200),
    platformSource,
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
  };
}

function parseRemoteOK(data) {
  if (!Array.isArray(data)) return [];
  const jobs = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.legal) continue;
    if (!raw.position || !raw.company) continue;
    const url = raw.url || raw.link || '';
    if (!url) continue;
    jobs.push(buildNormalizedJob(raw.position, raw.company, url, raw.location || 'Remote', 'Remote OK'));
  }
  return jobs;
}

function parseRemotive(data) {
  if (!data || !Array.isArray(data.jobs)) return [];
  const jobs = [];
  for (const raw of data.jobs) {
    try {
      if (!raw.title || !raw.company_name) continue;
      jobs.push(
        buildNormalizedJob(
          raw.title,
          raw.company_name,
          raw.url || '',
          raw.candidate_required_location || 'Remote',
          'Remotive'
        )
      );
    } catch (err) {
      console.error(`[API] Remotive: Failed to normalize job: ${err.message}`);
    }
  }
  return jobs;
}

function parseArbeitnow(data) {
  if (!data || !Array.isArray(data.data)) return [];
  const jobs = [];
  for (const raw of data.data) {
    try {
      if (!raw.title || !raw.company_name) continue;
      jobs.push(
        buildNormalizedJob(
          raw.title,
          raw.company_name,
          raw.url || '',
          raw.location || 'Remote',
          'Arbeitnow'
        )
      );
    } catch (err) {
      console.error(`[API] Arbeitnow: Failed to normalize job: ${err.message}`);
    }
  }
  return jobs;
}

const PARSERS = {
  'Remote OK': parseRemoteOK,
  Remotive: parseRemotive,
  Arbeitnow: parseArbeitnow,
};

async function fetchPlatform(platform) {
  console.log(`[API] Fetching from ${platform.name}: ${platform.url}`);

  const response = await fetchWithRetry(
    () => axiosInstance.get(platform.url),
    platform.name
  );

  const data = response.data;
  const parser = PARSERS[platform.name];

  if (!parser) {
    console.warn(`[API] No parser registered for platform: ${platform.name}`);
    return [];
  }

  const jobs = parser(data);
  console.log(`[API] ${platform.name}: Fetched ${jobs.length} jobs`);
  return jobs;
}

async function fetchJobs() {
  const allJobs = [];

  for (const platform of JSON_PLATFORMS) {
    try {
      const jobs = await fetchPlatform(platform);
      allJobs.push(...jobs);
    } catch (err) {
      console.error(`[API] Platform "${platform.name}" failed: ${err.message}`);
    }
  }

  console.log(`[API] Total jobs from all JSON platforms: ${allJobs.length}`);
  return allJobs;
}

module.exports = { fetchJobs };
