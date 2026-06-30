const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { atsPlatforms } = require('../../config/platforms');

const GREENHOUSE_URL = 'https://boards-api.greenhouse.io/v1/boards';
const LEVER_URL = 'https://api.lever.co/v0/postings';

const axiosInstance = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json',
  },
});

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function buildNormalizedJob(title, company, url, region, platformSource) {
  return {
    title: (title || 'Unknown Position').trim().substring(0, 300),
    company: (company || 'Unknown Company').trim().substring(0, 200),
    url: (url || '').trim(),
    region: (region || 'Remote').trim().substring(0, 200),
    platformSource,
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
  };
}

function slugToCompany(slug) {
  if (!slug) return 'Unknown';
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function fetchGreenhouseCompany(company) {
  const url = `${GREENHOUSE_URL}/${company}/jobs`;
  const source = `Greenhouse (${slugToCompany(company)})`;

  const response = await fetchWithRetry(
    () => axiosInstance.get(url),
    `Greenhouse/${company}`
  );

  const data = response.data;
  if (!data || !Array.isArray(data.jobs)) {
    console.warn(`[ATS] Greenhouse/${company}: Unexpected format`);
    return [];
  }

  const jobs = [];
  for (const raw of data.jobs) {
    try {
      if (!raw.title) continue;
      const title = raw.title;
      const companyName = raw.company_name || slugToCompany(company);
      const jobUrl = raw.absolute_url || '';
      const region = (raw.location && raw.location.name) ? raw.location.name.trim() : 'Remote';

      jobs.push(buildNormalizedJob(title, companyName, jobUrl, region, source));
    } catch (err) {
      console.error(`[ATS] Greenhouse/${company}: Failed to normalize job: ${err.message}`);
    }
  }

  return jobs;
}

async function fetchLeverCompany(company) {
  const url = `${LEVER_URL}/${company}?mode=json`;
  const source = `Lever (${slugToCompany(company)})`;

  const response = await fetchWithRetry(
    () => axiosInstance.get(url),
    `Lever/${company}`
  );

  const data = response.data;
  if (!Array.isArray(data)) {
    console.warn(`[ATS] Lever/${company}: Expected array, got ${typeof data}`);
    return [];
  }

  const jobs = [];
  for (const raw of data) {
    try {
      if (!raw.text) continue;
      const title = raw.text;
      const companyName = slugToCompany(company);
      const jobUrl = raw.hostedUrl || raw.applyUrl || '';
      const region =
        (raw.categories && raw.categories.location) ? raw.categories.location.trim() :
        (raw.location) ? raw.location.trim() :
        'Remote';

      jobs.push(buildNormalizedJob(title, companyName, jobUrl, region, source));
    } catch (err) {
      console.error(`[ATS] Lever/${company}: Failed to normalize job: ${err.message}`);
    }
  }

  return jobs;
}

async function fetchJobs() {
  const allJobs = [];
  const greenhouse = atsPlatforms.greenhouse || [];
  const lever = atsPlatforms.lever || [];

  for (const company of greenhouse) {
    try {
      console.log(`[ATS] Greenhouse: Fetching ${company}...`);
      const jobs = await fetchGreenhouseCompany(company);
      console.log(`[ATS] Greenhouse/${company}: Fetched ${jobs.length} jobs`);
      allJobs.push(...jobs);
    } catch (err) {
      console.error(`[ATS] Greenhouse/${company} failed: ${err.message}`);
    }
  }

  for (const company of lever) {
    try {
      console.log(`[ATS] Lever: Fetching ${company}...`);
      const jobs = await fetchLeverCompany(company);
      console.log(`[ATS] Lever/${company}: Fetched ${jobs.length} jobs`);
      allJobs.push(...jobs);
    } catch (err) {
      console.error(`[ATS] Lever/${company} failed: ${err.message}`);
    }
  }

  console.log(`[ATS] Total jobs from all ATS platforms: ${allJobs.length}`);
  return allJobs;
}

module.exports = { fetchJobs };
