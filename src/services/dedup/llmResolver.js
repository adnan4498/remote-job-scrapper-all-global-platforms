const OpenAI = require('openai');

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.x.ai/v1';
const LLM_MODEL_NAME = process.env.LLM_MODEL_NAME || 'grok-4-1-fast';

const LLM_TIMEOUT_MS = 30000;
const MAX_CLUSTER_SIZE = 10;
const MAX_CLUSTERS_PER_BATCH = 8;

let openai = null;
let llmAvailable = false;

function initClient() {
  if (LLM_API_KEY) {
    try {
      openai = new OpenAI({
        apiKey: LLM_API_KEY,
        baseURL: LLM_BASE_URL,
        timeout: LLM_TIMEOUT_MS,
        maxRetries: 1,
      });
      llmAvailable = true;
      console.log(`[LLM] Initialized client: ${LLM_BASE_URL} | model: ${LLM_MODEL_NAME}`);
    } catch (err) {
      console.warn(`[LLM] Failed to initialize client: ${err.message}`);
      llmAvailable = false;
    }
  } else {
    console.warn('[LLM] LLM_API_KEY not configured. LLM deduplication layer bypassed.');
    llmAvailable = false;
  }
}

initClient();

const SYSTEM_PROMPT = `You are an expert technical recruiter and data deduplication analyst. Your task is to evaluate clusters of job listings and determine which represent the exact same hiring intent (cross-posted across platforms) versus genuinely distinct job openings.

For each cluster, you receive an array of job objects with fields: _id, title, company, platformSource, url, region.

Rules for determining duplicates:
1. Same company and highly similar titles with minor wording differences (e.g., "Sr. Node.js Developer" vs "Senior Node.js Engineer") → one is a DUPLICATE of the other
2. Same company, same role but different specializations (e.g., "Frontend Developer" vs "Backend Developer") → DISTINCT, not duplicates
3. Same company, explicitly different seniority levels (e.g., "Junior Developer" vs "Senior Developer") → DISTINCT
4. Different companies → DISTINCT (ignore)
5. Vague "Unknown" company names → evaluate title similarity more strictly
6. Same title but at clearly different locations/regions → usually DISTINCT unless the region is just "Remote" and everything else matches

Return ONLY a JSON object with this exact structure: {"duplicateIds":["id1","id2"]}

The duplicateIds array must contain the MongoDB _id values of the jobs that are confirmed duplicates (keep the first job in each group, flag the rest). If no duplicates are found, return {"duplicateIds":[]}. Never include explanations, only JSON.`;

function buildClusterPayload(cluster) {
  return cluster.map((job) => ({
    _id: job._id ? job._id.toString() : job._id,
    title: job.title,
    company: job.company,
    platformSource: job.platformSource,
    url: job.url,
    region: job.region || 'Remote',
  }));
}

async function resolveFuzzyDuplicates(clusters) {
  if (!llmAvailable || !openai) {
    console.log('[LLM] LLM not available. Skipping LLM deduplication pass.');
    return [];
  }

  if (!clusters || clusters.length === 0) {
    console.log('[LLM] No clusters provided. Skipping.');
    return [];
  }

  const trimmedClusters = clusters
    .filter((c) => c.length >= 2 && c.length <= MAX_CLUSTER_SIZE)
    .slice(0, MAX_CLUSTERS_PER_BATCH)
    .map((c) => c.slice(0, MAX_CLUSTER_SIZE));

  if (trimmedClusters.length === 0) {
    console.log('[LLM] No clusters within size limits. Skipping.');
    return [];
  }

  console.log(`[LLM] Evaluating ${trimmedClusters.length} clusters (${trimmedClusters.reduce((a, c) => a + c.length, 0)} total jobs)...`);

  const jobSummary = trimmedClusters.map((cluster, idx) =>
    `Cluster ${idx + 1}:\n${JSON.stringify(buildClusterPayload(cluster), null, 2)}`
  ).join('\n\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, LLM_TIMEOUT_MS);

  try {
    const response = await openai.chat.completions.create(
      {
        model: LLM_MODEL_NAME,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: jobSummary },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 2000,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      console.warn('[LLM] Empty response from model.');
      return [];
    }

    const parsed = JSON.parse(rawContent);
    const duplicateIds = parsed.duplicateIds || [];

    if (!Array.isArray(duplicateIds)) {
      console.warn('[LLM] Response missing duplicateIds array:', rawContent.substring(0, 200));
      return [];
    }

    console.log(`[LLM] Identified ${duplicateIds.length} duplicate job IDs`);
    return duplicateIds;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.type === 'request_timeout') {
      console.error('[LLM] Request timed out or was aborted.');
    } else if (err.status === 429) {
      console.error('[LLM] Rate limited by LLM provider.');
    } else if (err instanceof SyntaxError) {
      console.error('[LLM] Failed to parse JSON response:', err.message);
    } else {
      console.error('[LLM] API call failed:', err.message);
    }

    return [];
  }
}

module.exports = { resolveFuzzyDuplicates };
