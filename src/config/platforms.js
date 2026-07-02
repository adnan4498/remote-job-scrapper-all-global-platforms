const feedPlatforms = [
  {
    name: 'We Work Remotely',
    type: 'rss',
    url: 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
    source: 'We Work Remotely',
  },
  {
    name: 'Remote OK',
    type: 'json',
    url: 'https://remoteok.com/api',
    source: 'Remote OK',
  },
  {
    name: 'Remotive',
    type: 'json',
    url: 'https://remotive.com/api/remote-jobs',
    source: 'Remotive',
  },
  {
    name: 'Arbeitnow',
    type: 'json',
    url: 'https://arbeitnow.com/api/job-board-api',
    source: 'Arbeitnow',
  },
  {
    name: 'Working Nomads',
    type: 'rss',
    url: 'https://www.workingnomads.com/jobs/rss/development',
    source: 'Working Nomads',
  },
  {
    name: 'Jobspresso',
    type: 'rss',
    url: 'https://jobspresso.co/feed/',
    source: 'Jobspresso',
  },
];

const cheerioPlatforms = [
  { name: 'NoDesk', url: 'https://nodesk.co', scope: 'global' },
  { name: 'JustRemote', url: 'https://justremote.co/remote-developer-jobs', scope: 'global' },
  { name: 'Remote.io', url: 'https://www.remote.io/remote-developer-jobs', scope: 'global' },
  { name: 'Crunchboard', url: 'https://www.crunchboard.com', scope: 'global' },
  { name: 'SaaSTr Job Board', url: 'https://saastr.com/jobs', scope: 'global' },
  { name: 'CybersecurityJobs', url: 'https://www.cybersecurityjobs.com', scope: 'global' },
  { name: 'Infosec Jobs', url: 'https://infosec-jobs.com', scope: 'global' },
  { name: 'Cloud Computing Jobs', url: 'https://cloudjobs.net', scope: 'global' },
  { name: 'HackerJobs', url: 'https://hackerjobs.co.uk', scope: 'uk' },
];

const playwrightPlatforms = [
  { name: 'Remote.co', url: 'https://remote.co/remote-jobs/developer/', scope: 'global' },
  { name: 'Pangian', url: 'https://pangian.com', scope: 'global' },
  { name: 'PowerToFly', url: 'https://powertofly.com', scope: 'global' },
  { name: 'Dynamite Jobs', url: 'https://dynamitejobs.com', scope: 'global' },
  { name: 'Y Combinator Jobs', url: 'https://www.ycombinator.com/jobs', scope: 'global' },
  { name: 'Techstars Job List', url: 'https://jobs.techstars.com', scope: 'global' },
];

const protectedPlatforms = [
  { name: 'Indeed', baseUrl: 'indeed.com', subdomains: ['www', 'uk', 'ca', 'pk'], scope: 'regional' },
  { name: 'Glassdoor', baseUrl: 'glassdoor.com', scope: 'regional' },
  { name: 'ZipRecruiter', baseUrl: 'ziprecruiter.com', scope: 'regional' },
  { name: 'Wellfound', baseUrl: 'wellfound.com', scope: 'global' },
  { name: 'Dice', baseUrl: 'dice.com', scope: 'us' },
  { name: 'Built In', baseUrl: 'builtin.com', scope: 'us' },
  { name: 'Monster', baseUrl: 'monster.com', scope: 'regional' },
  { name: 'CareerBuilder', baseUrl: 'careerbuilder.com', scope: 'regional' },
];

const atsPlatforms = {
  greenhouse: [""],
  lever: ['lever', 'geekhunter', 'open-government-products'],
};

const aggregatorConfig = {
  keywords: [
    'react',
    // 'Node.js',
  ],
  regions: ['us', 'uk'],
  excludedCompanies: ['twilio', 'stripe', 'gitlab', 'microsoft', 'google', 'amazon', 'meta', 'apple'],
};

module.exports = {
  feedPlatforms,
  cheerioPlatforms,
  playwrightPlatforms,
  protectedPlatforms,
  atsPlatforms,
  aggregatorConfig,
};
