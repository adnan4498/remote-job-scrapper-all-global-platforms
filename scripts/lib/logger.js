'use strict';

const fs = require('fs').promises;
const path = require('path');

const LOG_FILE = path.resolve(__dirname, '..', '..', 'src', 'config', 'scrape-logs.json');

const memoryStore = {
  sessions: []
};

let sessionIndex = -1;

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
    const content = JSON.stringify(memoryStore, null, 2);
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
    if (parsed && Array.isArray(parsed.sessions)) {
      memoryStore.sessions = parsed.sessions;
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      memoryStore.sessions = [];
    }
  }
}

function startBatchSession(description) {
  const timestamp = formatTimestamp();
  const session = {
    timestamp,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    description: description || `Batch run — ${timestamp}`,
    entries: [],
    aggregate: {
      totalPlatforms: 0,
      totalJobs: 0,
      byRegion: {},
      byKeyword: {}
    }
  };

  memoryStore.sessions.push(session);
  sessionIndex = memoryStore.sessions.length - 1;

  persistToFile();

  return sessionIndex;
}

function logBatchEntry(platform, region, keyword, count, isMeta = false) {
  if (sessionIndex < 0 || sessionIndex >= memoryStore.sessions.length) return;

  const session = memoryStore.sessions[sessionIndex];
  const entry = {
    platform: String(platform),
    region: String(region),
    keyword: String(keyword),
    count: Number(count),
    isMeta: Boolean(isMeta)
  };

  session.entries.push(entry);

  session.aggregate.totalPlatforms = new Set(
    session.entries.filter(e => !e.isMeta).map(e => e.platform)
  ).size;

  if (!isMeta) {
    session.aggregate.totalJobs += count;
  }

  if (!session.aggregate.byRegion[region]) {
    session.aggregate.byRegion[region] = 0;
  }
  if (!isMeta) {
    session.aggregate.byRegion[region] += count;
  }

  if (!session.aggregate.byKeyword[keyword]) {
    session.aggregate.byKeyword[keyword] = 0;
  }
  if (!isMeta) {
    session.aggregate.byKeyword[keyword] += count;
  }

  persistToFile();
}

function finishBatchSession() {
  if (sessionIndex < 0 || sessionIndex >= memoryStore.sessions.length) return null;

  const session = memoryStore.sessions[sessionIndex];
  session.finishedAt = new Date().toISOString();

  persistToFile();

  return session;
}

function getCurrentSession() {
  if (sessionIndex < 0 || sessionIndex >= memoryStore.sessions.length) return null;
  return memoryStore.sessions[sessionIndex];
}

function getAllSessions() {
  return memoryStore.sessions;
}

function getSessionByIndex(index) {
  if (index < 0 || index >= memoryStore.sessions.length) return null;
  return memoryStore.sessions[index];
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
