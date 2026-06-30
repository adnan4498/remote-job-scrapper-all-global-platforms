'use strict';

const axios = require('axios');
const { REQUEST_TIMEOUT_MS, HTTP_STATUS, TIER_LABELS, USER_AGENTS } = require('./constants');

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function createAxiosInstance() {
  return axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    },
    validateStatus: (status) => status < 500
  });
}

async function detectWAF(domain) {
  const axiosInstance = createAxiosInstance();
  const url = `https://${domain}`;

  try {
    const response = await axiosInstance.get(url, {
      validateStatus: () => true
    });

    if (response.status === HTTP_STATUS.FORBIDDEN) {
      return {
        tier: 4,
        tierLabel: TIER_LABELS[4],
        reason: 'WAF Challenge (403 Forbidden)',
        wafDetected: true,
        statusCode: response.status,
        headers: response.headers,
        wafHeaders: extractWAFHeaders(response.headers)
      };
    }

    if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return {
        tier: 3,
        tierLabel: TIER_LABELS[3],
        reason: 'Rate Limited (429 Too Many Requests)',
        wafDetected: true,
        statusCode: response.status,
        headers: response.headers,
        wafHeaders: extractWAFHeaders(response.headers)
      };
    }

    const wafHeaders = extractWAFHeaders(response.headers);
    const hasWAF = wafHeaders.length > 0 || detectWAFInBody(response.data);

    if (hasWAF && response.status === HTTP_STATUS.OK) {
      return {
        tier: 2,
        tierLabel: TIER_LABELS[2],
        reason: 'WAF Detected (Challenge Present)',
        wafDetected: true,
        statusCode: response.status,
        headers: response.headers,
        wafHeaders
      };
    }

    if (response.status === HTTP_STATUS.NOT_FOUND) {
      return {
        tier: 1,
        tierLabel: TIER_LABELS[1],
        reason: 'Not Found (404) - Open Access',
        wafDetected: false,
        statusCode: response.status,
        headers: response.headers
      };
    }

    return {
      tier: 1,
      tierLabel: TIER_LABELS[1],
      reason: 'Open Access',
      wafDetected: false,
      statusCode: response.status,
      headers: response.headers
    };

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return {
        tier: 4,
        tierLabel: TIER_LABELS[4],
        reason: 'Timeout / Connection Aborted',
        wafDetected: true,
        statusCode: null,
        error: error.message
      };
    }

    if (error.response?.status === HTTP_STATUS.FORBIDDEN) {
      return {
        tier: 4,
        tierLabel: TIER_LABELS[4],
        reason: 'WAF Challenge (403 Forbidden)',
        wafDetected: true,
        statusCode: error.response.status,
        headers: error.response.headers,
        wafHeaders: extractWAFHeaders(error.response.headers)
      };
    }

    if (error.response?.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return {
        tier: 3,
        tierLabel: TIER_LABELS[3],
        reason: 'Rate Limited (429)',
        wafDetected: true,
        statusCode: error.response.status,
        headers: error.response.headers,
        wafHeaders: extractWAFHeaders(error.response.headers)
      };
    }

    return {
      tier: 3,
      tierLabel: TIER_LABELS[3],
      reason: `Network Error: ${error.code || error.message}`,
      wafDetected: false,
      statusCode: error.response?.status || null,
      error: error.message
    };
  }
}

function extractWAFHeaders(headers) {
  const wafIndicators = [
    'cf-ray',
    'cf-cache-status',
    'server',
    'x-sucuri-id',
    'x-sucuri-cache',
    'x-sucuri-block',
    'x-waf',
    'x-waf-event',
    'x-protected-by',
    'x-cdn',
    'x-akamai-transformed',
    'akamai-origin-hop',
    'x-incap-ses',
    'x-iinfo',
    'x-cdn',
    'x-fw-server',
    'x-shield',
    'x-protected-by',
    'cf-mitigated',
    'cf-chl-bypass',
    'x-frame-options',
    'x-content-type-options',
    'strict-transport-security'
  ];

  return Object.entries(headers)
    .filter(([key]) => wafIndicators.some(indicator => key.toLowerCase().includes(indicator)))
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
}

function detectWAFInBody(body) {
  if (!body || typeof body !== 'string') return false;

  const wafPatterns = [
    /cloudflare/i,
    /checking your browser/i,
    /please wait/i,
    /ddos protection/i,
    /access denied/i,
    /blocked by/i,
    /sucuri/i,
    /incapsula/i,
    /akamai/i,
    /imperva/i,
    /f5 networks/i,
    /barracuda/i,
    /fortinet/i,
    /palo alto/i,
    /checkpoint/i,
    /sophos/i,
    /radware/i,
    /f5 big-ip/i,
    /citrix netscaler/i,
    /aws waf/i,
    /cloudfront/i,
    /edgecast/i,
    /fastly/i,
    /vercel/i,
    /netlify/i,
    /challenge/i,
    /captcha/i,
    /verify you are human/i,
    /please enable javascript/i,
    /enable cookies/i,
    /browser check/i,
    /security check/i,
    /ray id/i
  ];

  return wafPatterns.some(pattern => pattern.test(body));
}

async function politeDelay(ms = 1500) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  detectWAF,
  politeDelay,
  createAxiosInstance,
  getRandomUserAgent,
  extractWAFHeaders,
  detectWAFInBody
};