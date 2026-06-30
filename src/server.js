require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const mongoose = require('mongoose');
const connectDB = require('./db');
const Job = require('./models/Job');
const { runAllScrapers } = require('./services/scraperOrchestrator');
const { initLogger, getAllSessions } = require('../scripts/lib/logger');

const app = express();
const PORT = process.env.PORT || 3000;
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'Asia/Karachi';
const VALID_STATUSES = ['Pending', 'Applied', 'Interviewing', 'Offered', 'Rejected', 'Archived', 'Duplicate'];

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());
// app.use(express.static(path.join(__dirname, '..', 'public')));
// app.use(express.static(path.join(__dirname, 'public'), { index: 'dashboard.html' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'dashboard.html' }));

app.get('/api/health', (_req, res) => {
  const state = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    status: 'ok',
    db: states[state] || 'unknown',
    uptime: process.uptime(),
  });
});

app.get('/api/jobs', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      filter.status = req.query.status;
    }
    const jobs = await Job.find(filter).sort({ scrapedAt: -1 }).lean();
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

app.post('/api/scrape', async (_req, res, next) => {
  try {
    const result = await runAllScrapers();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/jobs/:id/click', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { isClicked: true },
      { new: true }
    );
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/jobs/:id/status', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

app.post('/api/jobs/purge', async (_req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await Job.deleteMany({
      status: 'Pending',
      scrapedAt: { $lt: sevenDaysAgo },
    });
    res.json({ purged: result.deletedCount });
  } catch (err) {
    next(err);
  }
});

app.get('/api/scrape/logs', (_req, res) => {
  try {
    const sessions = getAllSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read scrape logs' });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const cronTask = cron.schedule(
  '0 9,21 * * *',
  async () => {
    console.log('[CRON] Triggering scheduled scrape run');
    try {
      await runAllScrapers();
    } catch (err) {
      console.error('[CRON] Scheduled scrape failed:', err.message);
    }
  },
  { timezone: CRON_TIMEZONE }
);

async function start() {
  await initLogger();
  await connectDB();
  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Cron scheduled for 9:00 AM and 9:00 PM (${CRON_TIMEZONE})`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Closing gracefully...`);
    cronTask.stop();
    server.close();
    try {
      await mongoose.connection.close();
      console.log('[SHUTDOWN] MongoDB connection closed');
    } catch (err) {
      console.error('[SHUTDOWN] Error closing MongoDB:', err.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
