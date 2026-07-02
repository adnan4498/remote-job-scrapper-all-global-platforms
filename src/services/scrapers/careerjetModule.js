const axios = require("axios");
const { fetchWithRetry } = require("./utils");

const CAREERJET_API_KEY = process.env.CAREERJET_API_KEY;
const BASE_URL = "https://search.api.careerjet.net/v4/query";

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

// const CAREERJET_REGIONS = [
//   'us', 'gb', 'au', 'ca', 'in', 'za', 'nl', 'fr',
//   'de', 'es', 'it', 'at', 'be', 'br', 'mx', 'nz',
//   'pl', 'sg', 'se', 'no', 'dk', 'fi', 'ch', 'ie',
//   'jp', 'kr', 'cn', 'hk', 'tw', 'ru', 'tr', 'ar',
//   'cl', 'co', 'pe', 've', 'uy', 'ec',
// ];

const CAREERJET_REGIONS = ["us","au"];

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);
}

function normalizeCareerjetResult(raw, region) {
  const title = (raw.title || "Unknown Position").trim().substring(0, 300);
  const company = (raw.company || "Unknown Company").trim().substring(0, 200);
  const url = (raw.url || "").trim();
  const locationName = (raw.locations || "").trim();

  return {
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: "careerjet",
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    source: "careerjet",
    rawId: String(raw.id || ""),
    location: locationName,
    countryCode: region.toLowerCase(),
    description: (raw.description || "").trim(),
    salary: { min: null, max: null, currency: null },
    postedAt: raw.date ? new Date(raw.date) : null,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  const encodedKeyword = encodeURIComponent(`${keyword} remote`);
  const offset = (page - 1) * PAGE_SIZE;

  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params: {
          keywords: encodedKeyword,
          location: region,
          pagesize: PAGE_SIZE,
          offset,
          affid: CAREERJET_API_KEY,
          user_ip: '82.165.195.1',
          user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        auth: {
          username: CAREERJET_API_KEY,
          password: '',
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 30000,
      }),
    `Careerjet/${region}/${keyword}/page${page}`,
  );

  const data = response.data || {};

  if (data.type === "LOCATIONS" || !Array.isArray(data.jobs)) {
    return [];
  }

  return data.jobs.map((raw) => normalizeCareerjetResult(raw, region));
}

async function fetchCareerjetJobs(
  keyword,
  regions = CAREERJET_REGIONS,
  seenFingerprints = null,
) {
  const allJobs = [];

  for (const region of regions) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);
        if (pageJobs.length === 0) break;

        if (seenFingerprints) {
          const uniquePageJobs = pageJobs.filter((job) => {
            if (!job.title || !job.company) return false;
            const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
            if (seenFingerprints.has(fp)) return false;
            seenFingerprints.add(fp);
            return true;
          });
          if (uniquePageJobs.length === 0) break;
          allJobs.push(...uniquePageJobs);
          console.log(
            `[CAREERJET] ${region}/${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes)`,
          );
        } else {
          allJobs.push(...pageJobs);
          console.log(
            `[CAREERJET] ${region}/${keyword} page ${page}: ${pageJobs.length} jobs`,
          );
        }
      } catch (err) {
        console.error(
          `[CAREERJET] ${region}/${keyword} page ${page} failed: ${err.message}`,
        );
      }
    }
  }

  console.log(
    `[CAREERJET] ${keyword} total: ${allJobs.length} jobs across ${regions.length} regions`,
  );
  return allJobs;
}

module.exports = { fetchCareerjetJobs, CAREERJET_REGIONS };
