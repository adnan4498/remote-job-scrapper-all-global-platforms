const OpenAI = require('openai');

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.x.ai/v1';
const LLM_MODEL_NAME = process.env.LLM_MODEL_NAME || 'openai/gpt-oss-120b';

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

CRITICAL RULES:
- The _id field contains a 24-character hexadecimal MongoDB ObjectId (e.g., "507f1f77bcf86cd799439011"). You MUST use these exact _id values from the input payload.
- NEVER invent, generate, or fabricate IDs. Only return _id values that appear verbatim in the provided JSON payload.
- If two jobs are duplicates of each other, keep the first one in the cluster and add the later job's _id to duplicateIds.

Duplicate detection rules:
1. Same company and highly similar titles with minor wording → DUPLICATE
2. Same company, same role but different specializations → DISTINCT
3. Same company, explicitly different seniority levels → DISTINCT
4. Different companies → DISTINCT
5. Vague "Unknown" company names → evaluate title similarity more strictly
6. Same title but at clearly different locations → usually DISTINCT unless region is "Remote"

Return ONLY a JSON object: {"duplicateIds":["507f1f77bcf86cd799439011","507f191e810c19729de860ea"]}. If no duplicates, return {"duplicateIds":[]}. Never include explanations, only JSON.`;

function buildClusterPayload(cluster) {
  return cluster.map((job) => ({
    _id: job._id ? job._id.toString() : '',
    title: job.title,
    company: job.company,
    platformSource: job.platformSource,
    url: job.url,
    region: job.region || 'Remote',
  }));
}

function extractValidIds(cluster) {
  const ids = new Set();
  for (const job of cluster) {
    if (job._id) {
      const idStr = job._id.toString ? job._id.toString() : String(job._id);
      if (/^[a-f0-9]{24}$/i.test(idStr)) {
        ids.add(idStr);
      }
    }
  }
  return ids;
}

function validateDuplicateIds(returnedIds, validIds) {
  if (!Array.isArray(returnedIds)) return [];
  return returnedIds.filter(id => {
    const idStr = String(id).trim();
    if (!/^[a-f0-9]{24}$/i.test(idStr)) {
      console.warn(`[LLM] Rejected invalid ObjectId from model: "${idStr}"`);
      return false;
    }
    if (!validIds.has(idStr)) {
      console.warn(`[LLM] Rejected fabricated ObjectId: "${idStr}" (not in input payload)`);
      return false;
    }
    return true;
  });
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

  const allValidIds = new Set();
  for (const cluster of trimmedClusters) {
    const ids = extractValidIds(cluster);
    for (const id of ids) allValidIds.add(id);
  }
  console.log(`[LLM] ${allValidIds.size} valid ObjectIds extracted from payload`);

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

    const cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1 || jsonStart >= jsonEnd) {
      console.warn('[LLM] No valid JSON object found in response:', rawContent.substring(0, 200));
      return [];
    }

    const jsonStr = cleaned.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);
    const rawIds = parsed.duplicateIds || [];

    if (!Array.isArray(rawIds)) {
      console.warn('[LLM] Response missing duplicateIds array:', rawContent.substring(0, 200));
      return [];
    }

    const duplicateIds = validateDuplicateIds(rawIds, allValidIds);

    if (rawIds.length !== duplicateIds.length) {
      console.warn(`[LLM] Filtered ${rawIds.length - duplicateIds.length} invalid/fabricated IDs from model response`);
    }

    console.log(`[LLM] Identified ${duplicateIds.length} valid duplicate job IDs`);
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
