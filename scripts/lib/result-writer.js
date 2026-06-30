'use strict';

const fs = require('fs').promises;
const fsc = require('fs');
const path = require('path');

const OUTPUT_FILE = path.resolve(__dirname, '..', '..', 'src', 'config', 'discovered-patterns.json');

async function atomicWriteFile(filePath, content) {
  const tempFile = `${filePath}.tmp`;
  await fs.writeFile(tempFile, content, 'utf-8');
  try {
    await fs.rename(tempFile, filePath);
  } catch (renameErr) {
    if (renameErr.code === 'EPERM' || renameErr.code === 'EACCES') {
      await fs.copyFile(tempFile, filePath);
      await fs.unlink(tempFile);
    } else {
      throw renameErr;
    }
  }
}

async function ensureOutputDirectory() {
  const dir = path.dirname(OUTPUT_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function readExistingPatterns() {
  try {
    await ensureOutputDirectory();
    const data = await fs.readFile(OUTPUT_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function createPlatformEntry(platformName, domain, result) {
  const tierLabels = {
    1: 'Tier 1 (Open)',
    2: 'Tier 2 (Challenged)',
    3: 'Tier 3 (Restricted)',
    4: 'Tier 4 (Protected)'
  };

  let tier = result.wafResult?.tier || 1;
  let paradigm = 'Unknown';
  let urlPattern = null;
  let noiseVariables = [];

  if (result.discoveryResult?.success) {
    paradigm = result.discoveryResult.paradigm;
    urlPattern = result.discoveryResult.template;
  } else if (result.wafResult?.wafDetected) {
    paradigm = 'Blocked';
    urlPattern = null;
  } else {
    paradigm = 'Not Found';
    urlPattern = null;
  }

  if (result.dissectionResult?.noiseParamsRemoved) {
    noiseVariables = [...new Set(result.dissectionResult.noiseParamsRemoved)];
  }

  const statusCode = result.discoveryResult?.status || result.wafResult?.statusCode || null;

  if (paradigm === 'Not Found' || statusCode == null) {
    tier = 4;
    urlPattern = null;
  }

  const tierLabel = tierLabels[tier] || 'Tier 1 (Open)';

  return {
    domain,
    tier: tierLabel,
    paradigm,
    urlPattern,
    noiseVariables,
    discoveredAt: new Date().toISOString(),
    validatedUrl: result.discoveryResult?.validatedUrl || null,
    finalUrl: result.discoveryResult?.finalUrl || null,
    region: result.discoveryResult?.region || null,
    statusCode
  };
}

async function writePattern(platformName, domain, result) {
  await ensureOutputDirectory();

  const existingPatterns = await readExistingPatterns();

  const platformKey = platformName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const newEntry = createPlatformEntry(platformName, domain, result);

  const updatedPatterns = {
    ...existingPatterns,
    [platformKey]: newEntry
  };

  const tempFile = `${OUTPUT_FILE}.tmp`;
  const content = JSON.stringify(updatedPatterns, null, 2);
  await atomicWriteFile(OUTPUT_FILE, content);

  return newEntry;
}

async function writeAllPatterns(results) {
  await ensureOutputDirectory();

  const existingPatterns = await readExistingPatterns();
  const updatedPatterns = { ...existingPatterns };

  for (const result of results) {
    const platformKey = result.platformName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    updatedPatterns[platformKey] = createPlatformEntry(result.platformName, result.domain, result);
  }

  const content = JSON.stringify(updatedPatterns, null, 2);
  await atomicWriteFile(OUTPUT_FILE, content);

  return updatedPatterns;
}

async function getPattern(platformName) {
  const patterns = await readExistingPatterns();
  const platformKey = platformName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return patterns[platformKey] || null;
}

async function listPatterns() {
  return await readExistingPatterns();
}

async function deletePattern(platformName) {
  const patterns = await readExistingPatterns();
  const platformKey = platformName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  if (patterns[platformKey]) {
    delete patterns[platformKey];
    const content = JSON.stringify(patterns, null, 2);
    await atomicWriteFile(OUTPUT_FILE, content);
    return true;
  }
  return false;
}

async function updatePatternEntry(platformKey, updates) {
  const patterns = await readExistingPatterns();
  if (patterns[platformKey]) {
    patterns[platformKey] = { ...patterns[platformKey], ...updates };
    const content = JSON.stringify(patterns, null, 2);
    await atomicWriteFile(OUTPUT_FILE, content);
    return patterns[platformKey];
  }
  return null;
}

async function overwriteAllPatterns(patterns) {
  await ensureOutputDirectory();
  const content = JSON.stringify(patterns, null, 2);
  await atomicWriteFile(OUTPUT_FILE, content);
}

async function clearAllPatterns() {
  const content = '{}';
  await atomicWriteFile(OUTPUT_FILE, content);
}

module.exports = {
  writePattern,
  writeAllPatterns,
  readExistingPatterns,
  updatePatternEntry,
  overwriteAllPatterns,
  getPattern,
  listPatterns,
  deletePattern,
  clearAllPatterns,
  OUTPUT_FILE
};