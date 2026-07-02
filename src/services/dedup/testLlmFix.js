const connectDB = require('../../db');
const Job = require('../../models/Job');
const {
  groupByCompany,
  buildClusters,
  titleSimilarity,
} = require('../scraperOrchestrator');
const { resolveFuzzyDuplicates } = require('./llmResolver');

(async () => {
  console.log('[TEST] ===== Isolated LLM Dedup Test =====');

  await connectDB();

  const totalJobs = await Job.countDocuments({});
  console.log(`[TEST] MongoDB connected. Total jobs: ${totalJobs}`);

  const jobs = await Job.find({}).lean();
  console.log(`[TEST] Fetched ${jobs.length} jobs for clustering`);

  if (jobs.length < 2) {
    console.log('[TEST] Not enough jobs to deduplicate. Exiting.');
    process.exit(0);
  }

  const companyGroups = groupByCompany(jobs);
  console.log(`[TEST] Grouped into ${companyGroups.length} companies`);

  const allClusters = [];
  for (const group of companyGroups) {
    const clusters = buildClusters(group);
    allClusters.push(...clusters);
  }

  console.log(`[TEST] Built ${allClusters.length} suspect clusters`);

  if (allClusters.length === 0) {
    console.log('[TEST] No clusters to evaluate. Exiting.');
    process.exit(0);
  }

  console.log('[TEST] Invoking LLM deduplication layer...');
  const duplicateIds = await resolveFuzzyDuplicates(allClusters);

  console.log(`[TEST] LLM returned ${duplicateIds.length} duplicate IDs:`);
  if (duplicateIds.length > 0) {
    for (const id of duplicateIds) {
      const job = jobs.find(j => j._id.toString() === id);
      const label = job ? `"${job.title}" @ ${job.company}` : 'UNKNOWN';
      console.log(`  ${id} → ${label}`);
    }
  } else {
    console.log('  (none)');
  }

  console.log('[TEST] Test complete. No status changes made to database.');
  process.exit(0);
})();
