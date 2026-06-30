'use strict';

const ISO_REGION_CODES = ['uk', 'gb'];
const REGION_CODES = ['uk', 'gb'];
const FALLBACK_REGIONS = ['us'];
const TARGET_KEYWORD = 'react';

const NOISE_QUERY_PARAMS = new Set([
  'vjk',
  '__cf_chl_f_tk',
  '__cf_chl_rt_tk',
  '__cf_chl_captcha_tk__',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'msclkid',
  'ref',
  'referrer',
  'source',
  'campaign_id',
  'adgroup_id',
  'creative_id',
  'keyword_id',
  'matchtype',
  'network',
  'device',
  'adposition',
  'targetid',
  'placement',
  'creative',
  'ad_id',
  'gad_source',
  'gad_campaignid',
  'gbraid',
  'wbraid',
  'yclid',
  'dclid',
  'li_fat_id',
  '_gl',
  '_ga',
  '_gid',
  '_gat',
  'amp',
  'amp_js_v',
  'amp_js_v2',
  'usqp',
  'ved',
  'ei',
  'iflsig',
  'oi',
  'authuser',
  'pj',
  'rct',
  'q',
  'sa',
  'ust',
  'usg'
]);

const LOCATION_QUERY_KEYS = [
  'location',
  'loc',
  'locat',
  'l',
  'cty',
  'city',
  'regi',
  'region',
  'state',
  'prov',
  'province',
  'area',
  'radius',
  'where',
  'w',
  'geo',
  'geoid',
  'postal',
  'zip',
  'country',
  'c'
];

const PARADIGM_NAMES = {
  1: 'Subdomain Switcher',
  2: 'Path Router',
  3: 'TLD Rotator',
  4: 'Parameter Target',
  5: 'Borderless Global'
};

const REQUEST_TIMEOUT_MS = 15000;
const POLITE_DELAY_MS = 1500;
const MAX_REDIRECTS = 5;
const SOFT_404_SELECTORS = [
  'body:empty',
  'body > *:not(script):not(style):not(noscript):not(meta):not(link):not(title):not(:empty)',
  '#main-content',
  '.main-content',
  '.job-list',
  '.jobs-container',
  '.search-results',
  '[data-testid="job-list"]',
  '[data-cy="job-list"]'
];

const TIER_LABELS = {
  1: 'Tier 1 (Open)',
  2: 'Tier 2 (Challenged)',
  3: 'Tier 3 (Restricted)',
  4: 'Tier 4 (Protected)'
};

const HTTP_STATUS = {
  OK: 200,
  REDIRECT: 302,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR: 500
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

module.exports = {
  ISO_REGION_CODES,
  REGION_CODES,
  FALLBACK_REGIONS,
  TARGET_KEYWORD,
  NOISE_QUERY_PARAMS,
  LOCATION_QUERY_KEYS,
  PARADIGM_NAMES,
  REQUEST_TIMEOUT_MS,
  POLITE_DELAY_MS,
  MAX_REDIRECTS,
  SOFT_404_SELECTORS,
  TIER_LABELS,
  HTTP_STATUS,
  USER_AGENTS
};