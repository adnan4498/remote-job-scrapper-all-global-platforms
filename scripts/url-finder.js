'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { TARGET_PLATFORMS } = require('./config/target-platforms');
const { detectWAF, politeDelay, createAxiosInstance, getRandomUserAgent } = require('./lib/waf-detector');
const { dissectUrl } = require('./lib/url-dissector');
const { writePattern, writeAllPatterns } = require('./lib/result-writer');
const { REQUEST_TIMEOUT_MS, HTTP_STATUS, TIER_LABELS, USER_AGENTS, REGION_CODES, FALLBACK_REGIONS, TARGET_KEYWORD, SOFT_404_SELECTORS } = require('./lib/constants');
const { PARADIGM_TEMPLATES } = require('./lib/paradigm-tester');

function createTestAxiosInstance() {
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

function validateHtmlContent(html, url) {
  if (!html || typeof html !== 'string' || html.length < 500) {
    return { valid: false, reason: 'Content too short or empty' };
  }

  const $ = cheerio.load(html);

  if ($('body').length === 0) {
    return { valid: false, reason: 'No body element' };
  }

  const bodyText = $('body').text().trim();
  if (bodyText.length < 100) {
    return { valid: false, reason: 'Body text too short' };
  }

  const hasJobMarkers = $(
    SOFT_404_SELECTORS.join(', ') +
    ', [class*="job"], [class*="search"], [class*="result"], [id*="job"], [id*="search"], [id*="result"]'
  ).length > 0;

  const hasContentElements = $('main, article, section, .content, .main, .container, #main, #content').length > 0;

  const hasNav = $('nav, header, .header, .navigation, [role="navigation"]').length > 0;

  const suspiciousPatterns = [
    /access denied/i,
    /blocked/i,
    /captcha/i,
    /challenge/i,
    /verify you are human/i,
    /please enable javascript/i,
    /enable cookies/i,
    /browser check/i,
    /security check/i,
    /cloudflare/i,
    /ray id/i,
    /checking your browser/i
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(bodyText)) {
      return { valid: false, reason: `Suspicious content detected: ${pattern.source}` };
    }
  }

  if (!hasJobMarkers && !hasContentElements && !hasNav) {
    return { valid: false, reason: 'No recognizable page structure found' };
  }

  return { valid: true, reason: 'Valid page structure detected' };
}

async function testUrl(axiosInstance, url, paradigmName, region) {
  try {
    const response = await axiosInstance.get(url, {
      validateStatus: () => true
    });

    if (response.status === HTTP_STATUS.FORBIDDEN || response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return {
        success: false,
        url,
        paradigm: paradigmName,
        region,
        statusCode: response.status,
        reason: response.status === HTTP_STATUS.FORBIDDEN ? '403 Forbidden' : '429 Rate Limited'
      };
    }

    if (response.status !== HTTP_STATUS.OK) {
      return {
        success: false,
        url,
        paradigm: paradigmName,
        region,
        statusCode: response.status,
        reason: `HTTP ${response.status}`
      };
    }

    const validation = validateHtmlContent(response.data, url);
    if (!validation.valid) {
      return {
        success: false,
        url,
        paradigm: paradigmName,
        region,
        statusCode: response.status,
        reason: `Soft 404: ${validation.reason}`
      };
    }

    const finalUrl = response.request?.res?.responseUrl || url;

    return {
      success: true,
      url,
      validatedUrl: finalUrl,
      finalUrl,
      paradigm: paradigmName,
      region,
      statusCode: response.status,
      template: url,
      html: response.data
    };

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return {
        success: false,
        url,
        paradigm: paradigmName,
        region,
        reason: 'Timeout'
      };
    }
    return {
      success: false,
      url,
      paradigm: paradigmName,
      region,
      reason: error.message
    };
  }
}

async function testAllParadigms(domain) {
  const baseDomain = domain.replace(/^www\./, '');
  const domainParts = baseDomain.split('.');
  const rootDomain = domainParts.slice(-2).join('.');
  const shortDomain = domainParts.slice(0, -2).join('.') || rootDomain;

  const axiosInstance = createTestAxiosInstance();

  for (const [paradigmName, templates] of Object.entries(PARADIGM_TEMPLATES)) {
    console.log(`  Testing ${paradigmName}...`);

    for (const region of REGION_CODES) {
      for (const template of templates) {
        const url = template
          .replace('{domain}', baseDomain)
          .replace('{keyword}', TARGET_KEYWORD)
          .replace('{region}', region);

        const result = await testUrl(axiosInstance, url, paradigmName, region);

        if (result.success) {
          return [result];
        }

        await politeDelay(1500);
      }
    }
  }

  for (const [paradigmName, templates] of Object.entries(PARADIGM_TEMPLATES)) {
    for (const region of FALLBACK_REGIONS) {
      for (const template of templates) {
        const url = template
          .replace('{domain}', baseDomain)
          .replace('{keyword}', TARGET_KEYWORD)
          .replace('{region}', region);

        const result = await testUrl(axiosInstance, url, paradigmName, region);

        if (result.success) {
          return [result];
        }

        await politeDelay(1500);
      }
    }
  }

  const allResults = [];
  for (const [paradigmName, templates] of Object.entries(PARADIGM_TEMPLATES)) {
    for (const region of REGION_CODES) {
      for (const template of templates) {
        const url = template
          .replace('{domain}', baseDomain)
          .replace('{keyword}', TARGET_KEYWORD)
          .replace('{region}', region);

        const result = await testUrl(axiosInstance, url, paradigmName, region);
        allResults.push(result);
      }
    }
  }

  return allResults;
}

async function processPlatform(domain) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${domain}`);
  console.log(`'='.repeat(60)}`);

  const platformName = domain.split('.')[0];

  const wafResult = await detectWAF(domain);
  console.log(`WAF Check: ${wafResult.tierLabel} - ${wafResult.reason}`);

  if (wafResult.tier === 4) {
    console.log(`Skipping paradigm discovery - Tier 4 Protected`);
    return {
      platformName,
      domain,
      wafResult,
      discoveryResult: { success: false, reason: 'Tier 4 - Protected by WAF' },
      dissectionResult: null
    };
  }

  if (wafResult.tier === 3) {
    console.log(`Proceeding with caution - Tier 3 Restricted`);
  }

  console.log(`Testing routing paradigms...`);
  const discoveryResults = await testAllParadigms(domain);

  const successfulResult = discoveryResults.find(r => r.success);

  if (successfulResult) {
    console.log(`✓ Paradigm found: ${successfulResult.paradigm}`);
    console.log(`  URL: ${successfulResult.validatedUrl}`);
    console.log(`  Template: ${successfulResult.template}`);
    console.log(`  Region: ${successfulResult.region}`);

    const dissectionResult = dissectUrl(successfulResult.finalUrl || successfulResult.validatedUrl);
    console.log(`Clean template: ${dissectionResult.template}`);

    return {
      platformName,
      domain,
      wafResult,
      discoveryResult: successfulResult,
      dissectionResult
    };
  } else {
    console.log(`✗ No valid paradigm discovered`);
    const failureReasons = discoveryResults.map(r => `${r.paradigm}: ${r.reason}`).join('; ');
    return {
      platformName,
      domain,
      wafResult,
      discoveryResult: { success: false, reason: failureReasons },
      dissectionResult: null
    };
  }
}

async function runDiscovery() {
  console.log('Starting URL Routing Paradigm Discovery Engine');
  console.log(`Target platforms: ${TARGET_PLATFORMS.length}`);
  console.log(`Testing paradigms: Subdomain Switcher, Path Router, TLD Rotator, Query Parameter, Hybrid Router`);
  console.log(`Region codes: uk, gb`);
  console.log(`Keyword: react`);

  const results = [];

  for (let i = 0; i < TARGET_PLATFORMS.length; i++) {
    const domain = TARGET_PLATFORMS[i];
    console.log(`\n[${i + 1}/${TARGET_PLATFORMS.length}]`);

    try {
      const result = await processPlatform(domain);
      results.push(result);

      await writePattern(result.platformName, result.domain, result);

      if (i < TARGET_PLATFORMS.length - 1) {
        console.log(`Waiting 1500ms before next platform...`);
        await politeDelay(1500);
      }
    } catch (error) {
      console.error(`Error processing ${domain}: ${error.message}`);
      results.push({
        platformName: domain.split('.')[0],
        domain,
        wafResult: { tier: 3, tierLabel: TIER_LABELS[3], reason: `Error: ${error.message}` },
        discoveryResult: { success: false, reason: error.message },
        dissectionResult: null
      });
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('DISCOVERY COMPLETE');
  console.log(`${'='.repeat(60)}`);

  const summary = results.map(r => ({
    platform: r.platformName,
    domain: r.domain,
    tier: r.wafResult?.tierLabel || 'Unknown',
    paradigm: r.discoveryResult?.paradigm || 'Failed',
    template: r.dissectionResult?.template || 'N/A'
  }));

  console.table(summary);

  await writeAllPatterns(results);

  console.log(`\nResults written to: src/config/discovered-patterns.json`);

  return results;
}

if (require.main === module) {
  runDiscovery()
    .then(results => {
      const successCount = results.filter(r => r.discoveryResult?.success).length;
      console.log(`\nSuccessful discoveries: ${successCount}/${results.length}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = {
  runDiscovery,
  processPlatform,
  testAllParadigms,
  testUrl,
  validateHtmlContent
};