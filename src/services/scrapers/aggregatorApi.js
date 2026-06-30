const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { aggregatorConfig } = require('../../config/platforms');

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_API_KEY = process.env.ADZUNA_API_KEY;
const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY;

const MOCK_JOBS = [
  {
    title: 'Senior Node.js Developer',
    company: 'TechCorp Global',
    url: 'https://example.com/job/mock-node-001',
    region: 'Remote (US)',
    source: 'Adzuna/Jooble (Mock)',
  },
  {
    title: 'Full Stack Engineer (React + Node)',
    company: 'CloudScale Inc',
    url: 'https://example.com/job/mock-react-002',
    region: 'Remote (Europe)',
    source: 'Adzuna/Jooble (Mock)',
  },
  {
    title: 'Backend Engineer - Microservices',
    company: 'DataStream Systems',
    url: 'https://example.com/job/mock-micro-003',
    region: 'Remote (Worldwide)',
    source: 'Adzuna/Jooble (Mock)',
  },
  {
    title: 'DevOps & Platform Engineer',
    company: 'InfraWorks Ltd',
    url: 'https://example.com/job/mock-devops-004',
    region: 'Remote (Americas)',
    source: 'Adzuna/Jooble (Mock)',
  },
  {
    title: 'Python Backend Developer',
    company: 'AI Innovations Lab',
    url: 'https://example.com/job/mock-python-005',
    region: 'Remote (Global)',
    source: 'Adzuna/Jooble (Mock)',
  },
  {
    title: '.NET Developer - Cloud Services',
    company: 'Enterprise Softworks',
    url: 'https://example.com/job/mock-dotnet-006',
    region: 'Remote (UK)',
    source: 'Adzuna/Jooble (Mock)',
  },
  {
    title: 'React Native Mobile Engineer',
    company: 'AppForge Studio',
    url: 'https://example.com/job/mock-rn-007',
    region: 'Remote (Canada)',
    source: 'Adzuna/Jooble (Mock)',
  },
  {
    title: 'Senior Full Stack Developer',
    company: 'Digital Frontier Inc',
    url: 'https://example.com/job/mock-fs-008',
    region: 'Remote (US)',
    source: 'Adzuna/Jooble (Mock)',
  },
];

function buildNormalizedJob(title, company, url, region, source) {
  const slug = `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);

  return {
    title: (title || 'Unknown Position').trim().substring(0, 300),
    company: (company || 'Unknown Company').trim().substring(0, 200),
    url: (url || '').trim(),
    region: (region || 'Remote').trim().substring(0, 200),
    platformSource: source,
    slug,
    scrapedAt: new Date(),
  };
}

function buildMockJobs() {
  return MOCK_JOBS.map((raw) =>
    buildNormalizedJob(raw.title, raw.company, raw.url, raw.region, raw.source)
  );
}

async function fetchAdzunaJob(keyword, region) {
  const encodedKeyword = encodeURIComponent(keyword);
  const url = `https://api.adzuna.com/v1/api/jobs/${region}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_API_KEY}&what=${encodedKeyword}&results_per_page=20&content-type=application/json`;

  const response = await fetchWithRetry(
    () => axios.get(url, { timeout: 30000 }),
    `Adzuna/${region}/${keyword}`
  );

  const results = response.data && response.data.results;
  if (!Array.isArray(results)) return [];

  return results.map((raw) =>
    buildNormalizedJob(
      raw.title,
      raw.company && raw.company.display_name ? raw.company.display_name : 'Unknown',
      raw.redirect_url || raw.url || '',
      raw.location && raw.location.display_name ? raw.location.display_name : region.toUpperCase(),
      'Adzuna'
    )
  );
}

async function fetchJoobleJob(keyword, region) {
  const url = `https://jooble.org/api/${JOOBLE_API_KEY}`;
  const regionMap = { us: 'United States', uk: 'United Kingdom', ca: 'Canada' };

  const response = await fetchWithRetry(
    () =>
      axios.post(url, {
        keywords: keyword,
        location: regionMap[region] || region,
      }, { timeout: 30000 }),
    `Jooble/${region}/${keyword}`
  );

  const results = response.data && response.data.jobs;
  if (!Array.isArray(results)) return [];

  return results.map((raw) =>
    buildNormalizedJob(
      raw.title,
      raw.company || 'Unknown',
      raw.link || '',
      raw.location || regionMap[region] || region.toUpperCase(),
      'Jooble'
    )
  );
}

async function fetchRealJobs() {
  const allJobs = [];
  const { keywords, regions } = aggregatorConfig;

  for (const region of regions) {
    for (const keyword of keywords) {
      if (ADZUNA_APP_ID && ADZUNA_API_KEY) {
        try {
          const jobs = await fetchAdzunaJob(keyword, region);
          console.log(`[AGG] Adzuna ${region}/${keyword}: ${jobs.length} jobs`);
          allJobs.push(...jobs);
        } catch (err) {
          console.error(`[AGG] Adzuna ${region}/${keyword} failed: ${err.message}`);
        }
      }

      if (JOOBLE_API_KEY) {
        try {
          const jobs = await fetchJoobleJob(keyword, region);
          console.log(`[AGG] Jooble ${region}/${keyword}: ${jobs.length} jobs`);
          allJobs.push(...jobs);
        } catch (err) {
          console.error(`[AGG] Jooble ${region}/${keyword} failed: ${err.message}`);
        }
      }
    }
  }

  return allJobs;
}

function hasAnyApiKey() {
  return (ADZUNA_APP_ID && ADZUNA_API_KEY) || JOOBLE_API_KEY;
}

async function fetchJobs() {
  if (hasAnyApiKey()) {
    console.log('[AGG] API keys detected. Running real aggregator queries...');
    try {
      const jobs = await fetchRealJobs();
      if (jobs.length > 0) {
        console.log(`[AGG] Total aggregator jobs (real): ${jobs.length}`);
        return jobs;
      }
      console.warn('[AGG] Real API returned 0 jobs. Falling back to mock data.');
    } catch (err) {
      console.error(`[AGG] Real API pipeline failed: ${err.message}. Falling back to mock data.`);
    }
  } else {
    console.warn('[AGG] No Adzuna or Jooble API keys configured (ADZUNA_APP_ID/ADZUNA_API_KEY/JOOBLE_API_KEY). Using mock data.');
  }

  const jobs = buildMockJobs();
  console.log(`[AGG] Generated ${jobs.length} mock aggregator jobs`);
  return jobs;
}

module.exports = { fetchJobs };
