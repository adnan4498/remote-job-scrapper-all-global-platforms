const Job = require('../models/Job');
const mongoose = require('mongoose');
const rssFeedParser = require('./scrapers/rssFeedParser');
const apiIngestor = require('./scrapers/apiIngestor');
const aggregatorApi = require('./scrapers/aggregatorApi');
const atsIngestor = require('./scrapers/atsIngestor');
const cheerioScraper = require('./scrapers/cheerioScraper');
const playwrightScraper = require('./scrapers/playwrightScraper');
const protectedScraper = require('./scrapers/protectedScraper');
const { resolveFuzzyDuplicates } = require('./dedup/llmResolver');
const { startBatchSession, logBatchEntry, finishBatchSession } = require('../../scripts/lib/logger');
const { shouldExcludeCompany } = require('../../scripts/lib/company-filter');

const LIGHTWEIGHT_SCRAPERS = [
  { name: 'RSS Feed Parser', module: rssFeedParser },
  { name: 'API Ingestor', module: apiIngestor },
  { name: 'Aggregator API', module: aggregatorApi },
  { name: 'ATS Ingestor', module: atsIngestor },
];

const HEAVYWEIGHT_SCRAPERS = [
  { name: 'Cheerio Scraper', module: cheerioScraper },
  { name: 'Protected Scraper', module: protectedScraper },
  { name: 'Playwright Scraper', module: playwrightScraper },
];

const AUTO_DROP_THRESHOLD = 0.96;
const CLUSTER_FLOOR = 0.72;

function getChar(s, i) {
  return s.charAt(i);
}

function jaroWinkler(s1, s2) {
  const a1 = s1.toLowerCase().trim();
  const a2 = s2.toLowerCase().trim();

  if (a1 === a2) return 1.0;
  if (!a1.length || !a2.length) return 0.0;

  const matchWindow = Math.floor(Math.max(a1.length, a2.length) / 2) - 1;

  const a1Matches = new Array(a1.length).fill(false);
  const a2Matches = new Array(a2.length).fill(false);

  let matches = 0;

  for (let i = 0; i < a1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, a2.length);
    for (let j = start; j < end; j++) {
      if (!a2Matches[j] && getChar(a1, i) === getChar(a2, j)) {
        a1Matches[i] = true;
        a2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a1.length; i++) {
    if (!a1Matches[i]) continue;
    while (k < a2.length && !a2Matches[k]) k++;
    if (k < a2.length && getChar(a1, i) !== getChar(a2, k)) transpositions++;
    k++;
  }
  transpositions = Math.floor(transpositions / 2);

  const jaro = (
    matches / a1.length +
    matches / a2.length +
    (matches - transpositions) / matches
  ) / 3;

  let prefix = 0;
  const maxPrefix = 4;
  for (let i = 0; i < Math.min(a1.length, a2.length, maxPrefix); i++) {
    if (getChar(a1, i) === getChar(a2, i)) {
      prefix++;
    } else {
      break;
    }
  }

  const scalingFactor = 0.1;
  return jaro + prefix * scalingFactor * (1 - jaro);
}

function levenshteinDistance(a, b) {
  const aLen = a.length;
  const bLen = b.length;
  const matrix = [];

  for (let i = 0; i <= bLen; i++) matrix[i] = [i];
  for (let j = 0; j <= aLen; j++) matrix[0][j] = j;

  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[bLen][aLen];
}

function levenshteinSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function wordTokenOverlap(a, b) {
  const tokenize = (s) => {
    const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return new Set(words);
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  for (const word of setA) {
    if (setB.has(word)) return true;
  }
  return false;
}

function titleSimilarity(t1, t2) {
  if (!wordTokenOverlap(t1, t2)) return 0.0;

  const jw = jaroWinkler(t1, t2);
  const ls = levenshteinSimilarity(t1, t2);
  return Math.max(jw, ls);
}

async function isDuplicate(job) {
  const slugMatch = await Job.findOne({ slug: job.slug });
  if (slugMatch) return true;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentJobs = await Job.find({
    company: job.company,
    scrapedAt: { $gte: sevenDaysAgo },
  })
    .select('title company')
    .lean();

  for (const existing of recentJobs) {
    const sim = titleSimilarity(job.title, existing.title);
    if (sim >= AUTO_DROP_THRESHOLD) {
      return true;
    }
  }

  return false;
}

function groupByCompany(jobs) {
  const map = new Map();
  for (const job of jobs) {
    const key = job.company.toLowerCase().trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(job);
  }
  return Array.from(map.values());
}

function buildClusters(companyGroup) {
  if (companyGroup.length < 2) return [];

  const n = companyGroup.length;
  const adj = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = titleSimilarity(companyGroup[i].title, companyGroup[j].title);
      if (sim >= CLUSTER_FLOOR && sim < AUTO_DROP_THRESHOLD) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    const component = [];
    const stack = [i];
    visited.add(i);

    while (stack.length > 0) {
      const node = stack.pop();
      component.push(companyGroup[node]);
      for (const neighbor of adj[node]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    if (component.length >= 2) {
      clusters.push(component);
    }
  }

  return clusters;
}

async function applyDuplicateStatuses(duplicateIds) {
  if (!duplicateIds || duplicateIds.length === 0) return 0;

  try {
    const result = await Job.updateMany(
      { _id: { $in: duplicateIds } },
      { $set: { status: 'Duplicate' } }
    );
    console.log(`[ORCH] Marked ${result.modifiedCount} jobs as Duplicate via LLM`);
    return result.modifiedCount;
  } catch (err) {
    console.error(`[ORCH] Failed to mark duplicates: ${err.message}`);
    return 0;
  }
}

async function runAllScrapers() {
  console.log('[ORCH] ===== Scraping run started =====');

  if (mongoose.connection.readyState !== 1) {
    console.error('[ORCH] MongoDB is not connected (state: %d). Aborting scrape run.', mongoose.connection.readyState);
    return { inserted: 0, duplicates: 0, excluded: 0, invalid: 0, llmDuplicates: 0, errors: 1, total: 0, dbConnected: false };
  }

  console.log('[ORCH] DB state: connected (readyState=1), DB name: %s', mongoose.connection.db.databaseName);

  startBatchSession('Full platform scraping run');

  const allJobs = [];

  for (const scraper of LIGHTWEIGHT_SCRAPERS) {
    try {
      const jobs = await scraper.module.fetchJobs();
      console.log(`[ORCH] ${scraper.name}: ${jobs.length} jobs`);
      allJobs.push(...jobs);
      logBatchEntry(scraper.name, 'all', 'all', jobs.length, true);
    } catch (err) {
      console.error(`[ORCH] Scraper "${scraper.name}" failed:`, err.message);
      logBatchEntry(scraper.name, 'error', 'all', 0, true);
    }
  }

  console.log('[ORCH] Heavyweight scrapers starting...');

  for (const scraper of HEAVYWEIGHT_SCRAPERS) {
    try {
      const jobs = await scraper.module.fetchJobs();
      console.log(`[ORCH] ${scraper.name}: ${jobs.length} jobs`);
      allJobs.push(...jobs);
      logBatchEntry(scraper.name, 'all', 'all', jobs.length, true);
    } catch (err) {
      console.error(`[ORCH] Scraper "${scraper.name}" failed:`, err.message);
      logBatchEntry(scraper.name, 'error', 'all', 0, true);
    }
  }

  console.log(`[ORCH] Total raw jobs collected: ${allJobs.length}`);

  const allSlugs = allJobs.map(j => j.slug).filter(Boolean);
  const existingSlugDocs = await Job.find({ slug: { $in: allSlugs } }, { slug: 1, _id: 0 }).lean();
  const existingSlugs = new Set(existingSlugDocs.map(d => d.slug));
  console.log(`[ORCH] Slug pre-check: ${existingSlugs.size} of ${allSlugs.length} slugs already exist in DB`);

  let inserted = 0;
  let duplicates = 0;
  let excluded = 0;
  let errors = 0;
  let invalid = 0;
  let dupSkipped = 0;
  const candidateJobs = [];
  const bulkOps = [];

  for (const job of allJobs) {
    try {
      if (!job.url || !job.title || !job.company) {
        invalid++;
        continue;
      }

      if (shouldExcludeCompany(job.company)) {
        excluded++;
        continue;
      }

      if (existingSlugs.has(job.slug)) {
        dupSkipped++;
        continue;
      }

      if (await isDuplicate(job)) {
        duplicates++;
        continue;
      }

      existingSlugs.add(job.slug);

      bulkOps.push({
        updateOne: {
          filter: { url: job.url },
          update: { $setOnInsert: job },
          upsert: true
        }
      });

      candidateJobs.push(job);

    } catch (err) {
      console.error(`[ORCH] Error pre-processing "${job.title}": ${err.message}`);
      errors++;
    }
  }

  console.log(`[ORCH] Pre-filter complete: ${candidateJobs.length} candidates, ${invalid} invalid, ${excluded} excluded, ${dupSkipped} slug-skipped, ${duplicates} dup-skipped`);

  if (bulkOps.length > 0) {
    try {
      const bulkResult = await Job.bulkWrite(bulkOps, { ordered: false });
      inserted = bulkResult.upsertedCount || 0;
      const bulkDups = bulkOps.length - inserted;

      for (let i = 0; i < bulkResult.upsertedIds.length; i++) {
        const key = Object.keys(bulkResult.upsertedIds[i])[0];
        candidateJobs[i]._id = bulkResult.upsertedIds[i][key];
      }

      console.log(`[ORCH] bulkWrite complete: ${inserted} inserted, ${bulkDups} duplicates (total attempted: ${bulkOps.length})`);

      if (inserted <= 3 || inserted % 100 === 0) {
        const sample = candidateJobs.slice(0, 3).map(j => `"${j.title.substring(0, 35)}" @ ${j.platformSource}`).join(', ');
        console.log(`[ORCH] Sample inserts: ${sample || 'none'}`);
      }

      duplicates += bulkDups;

    } catch (bulkErr) {
      if (bulkErr.name === 'MongoBulkWriteError' && bulkErr.result) {
        const result = bulkErr.result;
        inserted = result.insertedCount || result.nInserted || 0;
        const upserted = result.upsertedCount || inserted;
        inserted = upserted;
        const bulkDups = bulkOps.length - upserted;

        if (result.upsertedIds) {
          for (let i = 0; i < result.upsertedIds.length; i++) {
            const key = Object.keys(result.upsertedIds[i])[0];
            candidateJobs[i]._id = result.upsertedIds[i][key];
          }
        }

        if (bulkErr.writeErrors) {
          console.error(`[ORCH] bulkWrite partial failure: ${bulkErr.writeErrors.length} write errors, ${inserted} succeeded`);
        }

        console.log(`[ORCH] bulkWrite partial: ${inserted} inserted, ${bulkDups} duplicates (total attempted: ${bulkOps.length})`);
        duplicates += bulkDups;
      } else {
        console.error(`[ORCH] bulkWrite failed: ${bulkErr.message}`);
        errors += bulkOps.length;
      }
    }
  } else {
    console.log(`[ORCH] No jobs to bulkWrite (all filtered out)`);
  }

  console.log(
    `[ORCH] Local dedup complete: ${inserted} inserted, ${duplicates} duplicates, ${excluded} excluded, ${dupSkipped} slug-skipped, ${invalid} invalid, ${errors} errors`
  );

  try {
    const dbTotal = await Job.countDocuments({});
    console.log(`[ORCH] MongoDB collection 'jobs' document count after upsert: ${dbTotal}`);
  } catch (dbCheckErr) {
    console.error(`[ORCH] Failed to verify DB count: ${dbCheckErr.message}`);
  }

  let llmDuplicates = 0;

  if (candidateJobs.length >= 2) {
    const companyGroups = groupByCompany(candidateJobs);
    const allClusters = [];

    for (const group of companyGroups) {
      const clusters = buildClusters(group);
      allClusters.push(...clusters);
    }

    if (allClusters.length > 0) {
      console.log(
        `[ORCH] ${allClusters.length} suspect cluster(s) → invoking LLM deduplication layer...`
      );
      try {
        const duplicateIds = await resolveFuzzyDuplicates(allClusters);
        llmDuplicates = await applyDuplicateStatuses(duplicateIds);
      } catch (err) {
        console.error(`[ORCH] LLM dedup pipeline failed: ${err.message}`);
      }
    }
  }

  console.log(
    `[ORCH] Run complete: ${inserted} inserted, ${duplicates} duplicates, ${excluded} excluded, ${dupSkipped} slug-skipped, ${invalid} invalid, ${llmDuplicates} LLM dedup, ${errors} errors`
  );

  finishBatchSession();

  return { inserted, duplicates, excluded, dupSkipped, invalid, llmDuplicates, errors, total: allJobs.length };
}

module.exports = {
  runAllScrapers,
  titleSimilarity,
  wordTokenOverlap,
  jaroWinkler,
  levenshteinSimilarity,
  levenshteinDistance,
  groupByCompany,
  buildClusters
};
