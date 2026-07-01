'use strict';

const fs = require('fs').promises;
const path = require('path');

const LOG_FILE = path.resolve(__dirname, '..', '..', 'src', 'config', 'scrape-logs.json');

const memoryStore = {
  runs: []
};

let currentRunIndex = -1;

function formatTimestamp(date = new Date()) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12 || 12;

  return `${dayName}, ${monthName} ${day}, ${year} \u2014 ${hours}:${minutes} ${ampm}`;
}

function formatShortTimestamp(date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();
  let h = date.getHours();
  const min = date.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${m}/${d}/${y} ${h}:${min} ${ampm}`;
}

async function ensureLogDirectory() {
  const dir = path.dirname(LOG_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function persistToFile() {
  try {
    await ensureLogDirectory();
    const tempFile = `${LOG_FILE}.tmp`;
    const content = JSON.stringify(memoryStore.runs, null, 2);
    await fs.writeFile(tempFile, content, 'utf-8');
    try {
      await fs.rename(tempFile, LOG_FILE);
    } catch (renameErr) {
      if (renameErr.code === 'EPERM' || renameErr.code === 'EACCES' || renameErr.code === 'ENOENT') {
        await fs.copyFile(tempFile, LOG_FILE);
        await fs.unlink(tempFile);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    console.error('[LOGGER] Failed to persist logs:', err.message);
  }
}

async function loadFromFile() {
  try {
    await ensureLogDirectory();
    const data = await fs.readFile(LOG_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      memoryStore.runs = parsed;
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      memoryStore.runs = [];
    }
  }
}

function startBatchSession(description) {
  const nextRunId = memoryStore.runs.length > 0
    ? Math.max(...memoryStore.runs.map(r => r.runId || 0)) + 1
    : 1;

  const timestamp = formatTimestamp();
  const shortTs = formatShortTimestamp();

  const run = {
    runId: nextRunId,
    timestamp,
    shortTimestamp: shortTs,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    description: description || `Run #${nextRunId} — ${shortTs}`,
    totalJobs: 0,
    entries: [],
    platforms: {}
  };

  memoryStore.runs.push(run);
  currentRunIndex = memoryStore.runs.length - 1;

  persistToFile();

  return currentRunIndex;
}

function logBatchEntry(platform, region, keyword, count, isMeta = false) {
  if (currentRunIndex < 0 || currentRunIndex >= memoryStore.runs.length) return;

  const run = memoryStore.runs[currentRunIndex];
  const entry = {
    platform: String(platform),
    region: String(region),
    keyword: String(keyword),
    count: Number(count),
    isMeta: Boolean(isMeta)
  };

  run.entries.push(entry);

  if (!isMeta) {
    run.totalJobs += count;

    const platformKey = entry.platform;
    if (!run.platforms[platformKey]) {
      run.platforms[platformKey] = 0;
    }
    run.platforms[platformKey] += count;
  }

  persistToFile();
}

function finishBatchSession() {
  if (currentRunIndex < 0 || currentRunIndex >= memoryStore.runs.length) return null;

  const run = memoryStore.runs[currentRunIndex];
  run.finishedAt = new Date().toISOString();

  persistToFile();

  return run;
}

function getCurrentSession() {
  if (currentRunIndex < 0 || currentRunIndex >= memoryStore.runs.length) return null;
  return memoryStore.runs[currentRunIndex];
}

function getAllSessions() {
  return memoryStore.runs;
}

function getSessionByIndex(index) {
  if (index < 0 || index >= memoryStore.runs.length) return null;
  return memoryStore.runs[index];
}

async function initLogger() {
  await loadFromFile();
}

module.exports = {
  initLogger,
  startBatchSession,
  logBatchEntry,
  finishBatchSession,
  getCurrentSession,
  getAllSessions,
  getSessionByIndex,
  formatTimestamp,
  LOG_FILE
};
