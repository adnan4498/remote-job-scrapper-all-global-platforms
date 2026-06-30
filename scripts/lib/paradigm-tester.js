'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { REQUEST_TIMEOUT_MS, POLITE_DELAY_MS, HTTP_STATUS, SOFT_404_SELECTORS, USER_AGENTS } = require('./constants');
const { politeDelay, getRandomUserAgent } = require('./waf-detector');

const PARADIGM_TEMPLATES = {
  'Subdomain Switcher': [
    'https://{region}.{domain}/jobs?q={keyword}',
    'https://{region}.{domain}/q-{keyword}-jobs.html',
    'https://{region}.{domain}/search?q={keyword}',
    'https://{region}.{domain}/jobs/{keyword}'
  ],
  'Path Router': [
    'https://{domain}/{region}/jobs?q={keyword}',
    'https://{domain}/{region}/search?q={keyword}',
    'https://{domain}/{region}/jobs/{keyword}',
    'https://{domain}/jobs/{region}/{keyword}'
  ],
  'TLD Rotator': [
    'https://{domain}.co.{region}/jobs?q={keyword}',
    'https://{domain}.{region}/jobs?q={keyword}',
    'https://{domain}.com.{region}/jobs?q={keyword}',
    'https://{domain}.co.{region}/search?q={keyword}'
  ],
  'Query Parameter': [
    'https://{domain}/jobs?q={keyword}&location={region}',
    'https://{domain}/search?q={keyword}&loc={region}',
    'https://{domain}/jobs?keyword={keyword}&country={region}',
    'https://{domain}/search?keyword={keyword}&region={region}'
  ],
  'Hybrid Router': [
    'https://{region}.{domain}/{region}/jobs?q={keyword}',
    'https://{domain}/{region}/jobs?q={keyword}&loc={region}',
    'https://{region}.{domain}/search?q={keyword}&loc={region}',
    'https://{domain}.co.{region}/{region}/jobs?q={keyword}'
  ]
};

const REGION_CODES = ['uk', 'gb'];

const TARGET_KEYWORD = 'react';

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

function buildUrlFromTemplate(template, domain, region, keyword) {
  return template
    .replace(/{domain}/g, domain)
    .replace(/{region}/g, region)
    .replace(/{keyword}/g, encodeURIComponent(keyword));
}

function validateSoft404(html, url) {
  if (!html || typeof html !== 'string' || html.trim().length === 0) {
    return { isSoft404: true, reason: 'Empty response body' };
  }

  const $ = cheerio.load(html);

  const bodyText = $('body').text().trim();
  if (bodyText.length < 100) {
    return { isSoft404: true, reason: 'Body text too short (< 100 chars)' };
  }

  const soft404Patterns = [
    /page not found/i,
    /404\s*[-:]\s*page not found/i,
    /the page you.{0,10}re looking for.{0,10}doesn.{0,10}t exist/i,
    /this page.{0,10}doesn.{0,10}t exist/i,
    /sorry.{0,20}page.{0,10}not found/i,
    /no results found/i,
    /no jobs found/i,
    /0 jobs found/i,
    /we couldn.{0,10}t find/i,
    /no matches found/i,
    /your search.{0,20}returned no results/i
  ];

  for (const pattern of soft404Patterns) {
    if (pattern.test(bodyText)) {
      return { isSoft404: true, reason: `Soft 404 pattern matched: ${pattern.source}` };
    }
  }

  let hasLayoutMarker = false;
  for (const selector of SOFT_404_SELECTORS) {
    try {
      if ($(selector).length > 0) {
        hasLayoutMarker = true;
        break;
      }
    } catch (e) {
    }
  }

  if (!hasLayoutMarker) {
    const jobLikeElements = $(
      '.job, .job-card, .job-listing, .job-item, [data-job], [data-testid*="job"], [data-cy*="job"], ' +
      '.vacancy, .position, .opening, .career-item, .search-result-item, ' +
      'article.job, li.job, div.job, .result-item, .listing-item'
    );

    if (jobLikeElements.length > 0) {
      hasLayoutMarker = true;
    }
  }

  if (!hasLayoutMarker) {
    const hasMainContent = $('#main, #content, main, .main, .content, .container, #main-content, .main-content').length > 0;
    if (!hasMainContent) {
      return { isSoft404: true, reason: 'No layout markers or main content containers found' };
    }
  }

  const linkCount = $('a[href]').length;
  if (linkCount < 5) {
    return { isSoft404: true, reason: `Too few links (${linkCount}) for a valid job board page` };
  }

  return { isSoft404: false, reason: 'Valid job search page detected' };
}

async function testParadigmVariant(axiosInstance, template, domain, region, keyword, paradigmName) {
  const url = buildUrlFromTemplate(template, domain, region, keyword);

  try {
    const response = await axiosInstance.get(url, { validateStatus: () => true });

    if (response.status === HTTP_STATUS.NOT_FOUND) {
      return { success: false, url, status: response.status, reason: '404 Not Found' };
    }

    if (response.status === HTTP_STATUS.FORBIDDEN) {
      return { success: false, url, status: response.status, reason: '403 Forbidden - WAF Challenge' };
    }

    if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return { success: false, url, status: response.status, reason: '429 Rate Limited' };
    }

    if (response.status >= 500) {
      return { success: false, url, status: response.status, reason: '5xx Server Error' };
    }

    if (response.status !== HTTP_STATUS.OK) {
      return { success: false, url, status: response.status, reason: `HTTP ${response.status}` };
    }

    const soft404Check = validateSoft404(response.data, url);
    if (soft404Check.isSoft404) {
      return { success: false, url, status: response.status, reason: `Soft 404: ${soft404Check.reason}` };
    }

    return {
      success: true,
      url,
      status: response.status,
      finalUrl: response.request?.res?.responseUrl || url,
      paradigm: paradigmName,
      template,
      region,
      keyword,
      htmlLength: response.data?.length || 0
    };

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return { success: false, url, status: null, reason: 'Timeout' };
    }
    if (error.response?.status === HTTP_STATUS.NOT_FOUND) {
      return { success: false, url, status: 404, reason: '404 Not Found' };
    }
    if (error.response?.status === HTTP_STATUS.FORBIDDEN) {
      return { success: false, url, status: 403, reason: '403 Forbidden' };
    }
    if (error.response?.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return { success: false, url, status: 429, reason: '429 Rate Limited' };
    }
    return { success: false, url, status: error.response?.status || null, reason: error.message };
  }
}

async function testParadigm(axiosInstance, paradigmName, templates, domain, keyword) {
  for (const template of templates) {
    for (const region of REGION_CODES) {
      await politeDelay(POLITE_DELAY_MS);

      const result = await testParadigmVariant(axiosInstance, template, domain, region, keyword, paradigmName);

      if (result.success) {
        return {
          paradigm: paradigmName,
          success: true,
          validatedUrl: result.url,
          finalUrl: result.finalUrl,
          template: result.template,
          region: result.region,
          keyword: result.keyword,
          htmlLength: result.htmlLength
        };
      }
    }
  }

  return { paradigm: paradigmName, success: false };
}

async function testAllParadigms(domain, keyword = TARGET_KEYWORD) {
  const axiosInstance = createAxiosInstance();
  const results = [];

  const paradigmOrder = [
    'Subdomain Switcher',
    'Path Router',
    'TLD Rotator',
    'Query Parameter',
    'Hybrid Router'
  ];

  for (const paradigmName of paradigmOrder) {
    const templates = PARADIGM_TEMPLATES[paradigmName];
    if (!templates) continue;

    const result = await testParadigm(axiosInstance, paradigmName, templates, domain, keyword);
    results.push(result);

    if (result.success) {
      break;
    }
  }

  return results;
}

module.exports = {
  testAllParadigms,
  testParadigm,
  testParadigmVariant,
  validateSoft404,
  buildUrlFromTemplate,
  PARADIGM_TEMPLATES,
  REGION_CODES,
  TARGET_KEYWORD
};