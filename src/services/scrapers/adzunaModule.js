const axios = require('axios');
const { fetchWithRetry } = require('./utils');

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_API_KEY = process.env.ADZUNA_API_KEY;
const BASE_URL = 'https://api.adzuna.com/v1/api/jobs';

const MAX_PAGES = 3;
const RESULTS_PER_PAGE = 50;
const MAX_DAYS_OLD = 3;

// const ADZUNA_REGIONS = [
//   'us', 'gb', 'au', 'ca', 'in', 'za', 'nl', 'fr',
//   'de', 'es', 'it', 'at', 'be', 'br', 'mx', 'nz',
//   'pl', 'sg',
// ];

const ADZUNA_REGIONS = [
  'us',
];

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeAdzunaResult(raw, region) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company && raw.company.display_name ? raw.company.display_name : 'Unknown Company').trim().substring(0, 200);
  const url = (raw.redirect_url || raw.url || '').trim();
  const locationName = raw.location && raw.location.display_name ? raw.location.display_name : region.toUpperCase();
  const countryCode = raw.location && raw.location.country_code
    ? raw.location.country_code.toLowerCase()
    : region.toLowerCase();

  return {
    title,
    company,
    url,
    region: locationName.trim().substring(0, 200),
    platformSource: 'Adzuna',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    source: 'adzuna',
    rawId: raw.id ? String(raw.id) : '',
    location: locationName,
    countryCode,
    description: raw.description || '',
    salary: {
      min: raw.salary_min != null ? Number(raw.salary_min) : null,
      max: raw.salary_max != null ? Number(raw.salary_max) : null,
      currency: raw.salary_currency_code || null,
    },
    postedAt: raw.created ? new Date(raw.created) : null,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  // Use a clean object for URLSearchParams to ensure valid encoding
  const params = new URLSearchParams({
    app_id: ADZUNA_APP_ID,
    app_key: ADZUNA_API_KEY,
    what: keyword,
    results_per_page: RESULTS_PER_PAGE.toString(),
    max_days_old: MAX_DAYS_OLD.toString()
  });

  const url = `${BASE_URL}/${region}/search/${page}?${params.toString()}`;

  const response = await fetchWithRetry(
    () => axios.get(url, { timeout: 30000 }),
    `Adzuna/${region}/${keyword}/page${page}`
  );

  // Safety: check if response.data and response.data.results exist
  if (!response.data || !Array.isArray(response.data.results)) {
    console.warn(`[ADZUNA] ${region}/${keyword} page ${page}: No results array found.`);
    return [];
  }

  return response.data.results
    .filter(raw => {
      const desc = (raw.description || '').toLowerCase();
      const title = (raw.title || '').toLowerCase();
      // Manual remote filter
      return desc.includes('remote') || title.includes('remote');
    })
    .map((raw) => normalizeAdzunaResult(raw, region));
}

async function fetchAdzunaJobs(keyword, regions = ADZUNA_REGIONS, seenFingerprints = null) {
  const allJobs = [];

  for (const region of regions) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);
        if (pageJobs.length === 0) break;

        if (seenFingerprints) {
          const uniquePageJobs = pageJobs.filter(job => {
            if (!job.title || !job.company) return false;
            const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
            if (seenFingerprints.has(fp)) return false;
            seenFingerprints.add(fp);
            return true;
          });
          if (uniquePageJobs.length === 0) {
            console.log(`[ADZUNA] ${region}/${keyword} page ${page}: all duplicates, breaking`);
            break;
          }
          allJobs.push(...uniquePageJobs);
          console.log(`[ADZUNA] ${region}/${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes dropped)`);
        } else {
          allJobs.push(...pageJobs);
          console.log(`[ADZUNA] ${region}/${keyword} page ${page}: ${pageJobs.length} jobs`);
        }
      } catch (err) {
        console.error(`[ADZUNA] ${region}/${keyword} page ${page} failed: ${err.message}`);
      }
    }
  }

  console.log(`[ADZUNA] ${keyword} total: ${allJobs.length} jobs across ${regions.length} regions`);
  return allJobs;
}

module.exports = { fetchAdzunaJobs, ADZUNA_REGIONS };
