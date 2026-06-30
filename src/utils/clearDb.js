require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('../models/Job');

async function clearDatabase() {
  try {
    // Falls back to local default if MONGODB_URI isn't specified in your .env
    const dbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jobscraper';
    
    console.log('[DB CLEAR] Connecting to target database instance...');
    await mongoose.connect(dbUri);

    const countBefore = await Job.countDocuments();
    console.log(`[DB CLEAR] Found ${countBefore} existing records to delete.`);

    const result = await Job.deleteMany({});
    console.log(`[DB CLEAR] Success! Deleted ${result.deletedCount} documents from the 'jobs' collection.`);

  } catch (error) {
    console.error('[DB CLEAR Error] Failed to purge collection:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('[DB CLEAR] Connection safely closed.');
    process.exit(0);
  }
}

clearDatabase();