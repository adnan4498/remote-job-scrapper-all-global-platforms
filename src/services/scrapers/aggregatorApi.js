const { aggregatorConfig } = require('../../config/platforms');
const { shouldExcludeCompany } = require('../../../scripts/lib/company-filter');
const { fetchAdzunaJobs } = require('./adzunaModule');
const { fetchJoobleJobs } = require('./joobleModule');

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

async function fetchRealJobs() {
  const allJobs = [];
  const { keywords } = aggregatorConfig;
  const seenFingerprints = new Set();

  for (const keyword of keywords) {
    let regionKeywordCount = 0;

    if (ADZUNA_APP_ID && ADZUNA_API_KEY) {
      try {
        const jobs = await fetchAdzunaJobs(keyword, undefined, seenFingerprints);
        const filtered = jobs.filter(j => !shouldExcludeCompany(j.company));
        if (filtered.length < jobs.length) {
          console.log(`[AGG] Adzuna ${keyword}: excluded ${jobs.length - filtered.length} jobs`);
        }
        allJobs.push(...filtered);
        regionKeywordCount += filtered.length;
      } catch (err) {
        console.error(`[AGG] Adzuna ${keyword} failed: ${err.message}`);
      }
    }

    if (JOOBLE_API_KEY) {
      try {
        const jobs = await fetchJoobleJobs(keyword, undefined, seenFingerprints);
        const filtered = jobs.filter(j => !shouldExcludeCompany(j.company));
        if (filtered.length < jobs.length) {
          console.log(`[AGG] Jooble ${keyword}: excluded ${jobs.length - filtered.length} jobs`);
        }
        allJobs.push(...filtered);
        regionKeywordCount += filtered.length;
      } catch (err) {
        console.error(`[AGG] Jooble ${keyword} failed: ${err.message}`);
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
