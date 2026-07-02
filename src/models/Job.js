const mongoose = require('mongoose');

const STATUS_ENUM = ['Pending', 'Applied', 'Interviewing', 'Offered', 'Rejected', 'Archived', 'Duplicate'];

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    company: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    region: {
      type: String,
      default: 'Remote',
      trim: true,
    },
    platformSource: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: STATUS_ENUM,
      default: 'Pending',
    },
    isClicked: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    scrapedAt: {
      type: Date,
      default: Date.now,
    },
    slug: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      trim: true,
    },
    rawId: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    countryCode: {
      type: String,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: '',
    },
    salary: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      currency: { type: String, default: null },
    },
    postedAt: {
      type: Date,
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

jobSchema.index({ url: 1 }, { unique: true });
jobSchema.index({ slug: 1 }, { unique: true });
jobSchema.index(
  { scrapedAt: 1 },
  {
    expireAfterSeconds: 7 * 24 * 60 * 60,
    partialFilterExpression: { status: 'Pending' },
  }
);

module.exports = mongoose.model('Job', jobSchema);
