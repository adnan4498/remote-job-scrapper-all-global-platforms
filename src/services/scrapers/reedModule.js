// const axios = require('axios');
// const { fetchWithRetry } = require('./utils');

// const REED_API_KEY = process.env.REED_API_KEY;
// const BASE_URL = 'https://www.reed.co.uk/api/1.0/search';

// const MAX_PAGES = 10;
// const RESULTS_PER_PAGE = 100;


// const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// function buildSlug(title, company) {
//   return `${title} ${company}`
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '-')
//     .replace(/^-+|-+$/g, '')
//     .substring(0, 200);
// }

// function normalizeReedResult(raw, region) {
//   const title = (raw.jobTitle || 'Unknown Position').trim().substring(0, 300);
//   const company = (raw.employerName || 'Unknown Company').trim().substring(0, 200);
//   const url = (raw.redirectUrl || '').trim();
//   const locationName = (raw.locationName || '').trim();
//   const description = (raw.jobDescription || '').trim();

//   const remoteRegex = /remote|work\s+from\s+home|wfh|home\s*-?\s*based/i;
//   if (!remoteRegex.test(title) && !remoteRegex.test(locationName) && !remoteRegex.test(description)) {
//     return null;
//   }

//   let postedAt = null;
//   if (raw.date) {
//     const parts = String(raw.date).split('/');
//     if (parts.length === 3) {
//       const day = parseInt(parts[0], 10);
//       const month = parseInt(parts[1], 10) - 1;
//       const year = parseInt(parts[2], 10);
//       postedAt = new Date(year, month, day);
//     }
//   }

//   if (postedAt && (Date.now() - postedAt.getTime()) > THREE_DAYS_MS) {
//     return null;
//   }

//   return {
//     title,
//     company,
//     url,
//     region: locationName || 'Remote',
//     platformSource: 'reed',
//     slug: buildSlug(title, company),
//     scrapedAt: new Date(),
//     source: 'reed',
//     rawId: String(raw.jobId || ''),
//     location: locationName,
//     countryCode: region.toLowerCase(),
//     description,
//     salary: { min: null, max: null, currency: null },
//     postedAt,
//     fetchedAt: new Date(),
//   };
// }

// async function fetchPage(keyword, region, page) {
//   const resultsToSkip = (page - 1) * RESULTS_PER_PAGE;

//   const response = await fetchWithRetry(
//     () =>
//       axios.get(BASE_URL, {
//         params: {
//           keywords: keyword,
//           resultsToTake: RESULTS_PER_PAGE,
//           resultsToSkip,
//         },
//         auth: {
//           username: REED_API_KEY,
//           password: '',
//         },
//         timeout: 30000,
//       }),
//     `Reed/${region}/${keyword}/page${page}`
//   );

//   const results = response.data && response.data.results;
//   if (!Array.isArray(results) || results.length === 0) return { jobs: [], rawCount: 0 };

//   const filtered = results
//     .map((raw) => normalizeReedResult(raw, region))
//     .filter(Boolean);

//   return { jobs: filtered, rawCount: results.length };
// }

// async function fetchReedJobs(keyword, seenFingerprints = null) {
//   const allJobs = [];

//   for (let page = 1; page <= MAX_PAGES; page++) {
//     try {
//       const { jobs: pageJobs, rawCount } = await fetchPage(keyword, 'uk', page);
//       if (rawCount === 0) break;
//       if (pageJobs.length === 0) continue;

//       if (seenFingerprints) {
//         const uniquePageJobs = pageJobs.filter(job => {
//           if (!job.title || !job.company) return false;
//           const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
//           if (seenFingerprints.has(fp)) return false;
//           seenFingerprints.add(fp);
//           return true;
//         });
//         if (uniquePageJobs.length === 0) continue;
//         allJobs.push(...uniquePageJobs);
//         console.log(`[REED] ${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes)`);
//       } else {
//         allJobs.push(...pageJobs);
//         console.log(`[REED] ${keyword} page ${page}: ${pageJobs.length} jobs`);
//       }
//     } catch (err) {
//       console.error(`[REED] ${keyword} page ${page} failed: ${err.message}`);
//     }
//   }

//   console.log(`[REED] ${keyword} total: ${allJobs.length} jobs`);
//   return allJobs;
// }

// module.exports = { fetchReedJobs };


const axios = require('axios');
const { fetchWithRetry } = require('./utils');

const REED_API_KEY = process.env.REED_API_KEY;
const BASE_URL = 'https://www.reed.co.uk/api/1.0/search';

const MAX_PAGES = 10;
const RESULTS_PER_PAGE = 100;

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeReedResult(raw, region) {
  const title = (raw.jobTitle || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.employerName || 'Unknown Company').trim().substring(0, 200);
  // const url = (raw.redirectUrl || '').trim();
  const url = (raw.jobUrl || raw.redirectUrl || '').trim();
  const locationName = (raw.locationName || '').trim();
  const description = (raw.description || raw.jobDescription || '').trim();

  let postedAt = null;
  if (raw.date) {
    const parts = String(raw.date).split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      postedAt = new Date(year, month, day);
    }
  }

  if (postedAt && (Date.now() - postedAt.getTime()) > THREE_DAYS_MS) {
    return null;
  }

  return {
    title,
    company,
    url,
    region: locationName || 'UK',
    platformSource: 'reed',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    source: 'reed',
    rawId: String(raw.jobId || ''),
    location: locationName,
    countryCode: region.toLowerCase(),
    description,
    salary: { min: null, max: null, currency: null },
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  const resultsToSkip = (page - 1) * RESULTS_PER_PAGE;

  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params: {
          keywords: keyword,
          resultsToTake: RESULTS_PER_PAGE,
          resultsToSkip,
        },
        auth: {
          username: REED_API_KEY,
          password: '',
        },
        timeout: 30000,
      }),
    `Reed/${region}/${keyword}/page${page}`
  );

  const results = response.data && response.data.results;
  if (!Array.isArray(results) || results.length === 0) return { jobs: [], rawCount: 0 };

  const filteredJobs = results
    .map((raw) => normalizeReedResult(raw, region))
    .filter(Boolean);

  return { jobs: filteredJobs, rawCount: results.length };
}

async function fetchReedJobs(keyword, seenFingerprints = null) {
  const allJobs = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const { jobs: pageJobs, rawCount } = await fetchPage(keyword, 'uk', page);
      if (rawCount === 0) break;
      if (pageJobs.length === 0) continue;

      if (seenFingerprints) {
        const uniquePageJobs = pageJobs.filter(job => {
          if (!job.title || !job.company) return false;
          const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
          if (seenFingerprints.has(fp)) return false;
          seenFingerprints.add(fp);
          return true;
        });
        if (uniquePageJobs.length === 0) continue;
        allJobs.push(...uniquePageJobs);
        console.log(`[REED] ${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes)`);
      } else {
        allJobs.push(...pageJobs);
        console.log(`[REED] ${keyword} page ${page}: ${pageJobs.length} jobs`);
      }
    } catch (err) {
      console.error(`[REED] ${keyword} page ${page} failed: ${err.message}`);
    }
  }

  console.log(`[REED] ${keyword} total: ${allJobs.length} jobs`);
  return allJobs;
}

module.exports = { fetchReedJobs };