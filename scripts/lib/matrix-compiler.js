'use strict';

const { URL } = require('url');

const DEFAULT_KEYWORD = 'react';

const LOCATION_QUERY_KEYS = [
  'location', 'loc', 'locat', 'l',
  'cty', 'city', 'regi', 'region',
  'state', 'prov', 'province', 'area',
  'radius', 'where', 'w',
  'geo', 'geoid', 'postal', 'zip',
  'country', 'c'
];

function substituteKeyword(urlStr, targetKeyword) {
  if (!urlStr || typeof urlStr !== 'string') return urlStr;
  if (!targetKeyword || targetKeyword === DEFAULT_KEYWORD) return urlStr;

  const encoded = encodeURIComponent(targetKeyword);
  const decoded = targetKeyword;

  let result = urlStr;

  result = result.replace(/([?&](?:q|keyword|query|search|text|term|keywords|what)=)react(?=&|$|\b)/gi, `$1${encoded}`);

  result = result.replace(/(\/)react((?:\/|-jobs|-job|$))/gi, `$1${encoded}$2`);

  result = result.replace(/\breact\b/gi, (match, offset, full) => {
    const before = full.substring(Math.max(0, offset - 20), offset);
    if (before.includes('?') || before.includes('&') || before.includes('/') || before.includes('-')) {
      return encoded;
    }
    return match;
  });

  return result;
}

function replaceSubdomainRegion(hostname, targetRegion) {
  if (targetRegion === 'global') {
    return hostname.replace(/^[a-z]{2,3}\./i, '');
  }

  const parts = hostname.split('.');
  if (parts.length >= 3 && /^[a-z]{2,3}$/i.test(parts[0])) {
    parts[0] = targetRegion;
    return parts.join('.');
  }

  return `${targetRegion}.${hostname}`;
}

function replacePathRegion(pathname, originalRegion, targetRegion) {
  if (!originalRegion || originalRegion === targetRegion) return pathname;

  const regionSlug = originalRegion.toLowerCase();
  const segments = pathname.split('/');

  for (let i = 1; i < segments.length; i++) {
    if (segments[i].toLowerCase() === regionSlug) {
      segments[i] = targetRegion;
      break;
    }
    if (segments[i] === `jobs-${regionSlug}` || segments[i] === `search-${regionSlug}`) {
      segments[i] = segments[i].replace(new RegExp(regionSlug, 'i'), targetRegion);
      break;
    }
  }

  return segments.join('/');
}

function replaceQueryRegion(searchParams, targetRegion) {
  for (const key of LOCATION_QUERY_KEYS) {
    if (searchParams.has(key)) {
      searchParams.set(key, targetRegion);
      return true;
    }
  }
  return false;
}

function compileMatrixUrl(platformEntry, targetKeyword = DEFAULT_KEYWORD, targetRegion = 'uk') {
  let url = platformEntry.urlPattern;

  if (!url || typeof url !== 'string' || url.length < 10) {
    url = platformEntry.validatedUrl || platformEntry.finalUrl || `https://${platformEntry.domain}`;
  }

  if (!url || typeof url !== 'string' || url.length < 10) {
    return null;
  }

  url = substituteKeyword(url, targetKeyword);

  const paradigm = platformEntry.paradigm || '';
  const originalRegion = (platformEntry.region || '').toLowerCase();

  if (!targetRegion || targetRegion === originalRegion) {
    return url;
  }

  try {
    const parsedUrl = new URL(url);

    switch (paradigm) {
      case 'Subdomain Switcher': {
        parsedUrl.hostname = replaceSubdomainRegion(parsedUrl.hostname, targetRegion);
        return parsedUrl.toString();
      }

      case 'Path Router': {
        parsedUrl.pathname = replacePathRegion(parsedUrl.pathname, originalRegion, targetRegion);
        return parsedUrl.toString();
      }

      case 'Query Parameter': {
        replaceQueryRegion(parsedUrl.searchParams, targetRegion);
        return parsedUrl.toString();
      }

      case 'Hybrid Router': {
        const oldHostname = parsedUrl.hostname;
        parsedUrl.hostname = replaceSubdomainRegion(parsedUrl.hostname, targetRegion);
        if (parsedUrl.hostname === oldHostname) {
          parsedUrl.pathname = replacePathRegion(parsedUrl.pathname, originalRegion, targetRegion);
        }
        replaceQueryRegion(parsedUrl.searchParams, targetRegion);
        return parsedUrl.toString();
      }

      case 'TLD Rotator': {
        if (originalRegion && originalRegion.length === 2) {
          parsedUrl.hostname = parsedUrl.hostname.replace(
            new RegExp(`\\.${originalRegion}(?=/|$|\.)`, 'i'),
            `.${targetRegion}`
          );
        }
        return parsedUrl.toString();
      }

      default: {
        replaceQueryRegion(parsedUrl.searchParams, targetRegion);
        return parsedUrl.toString();
      }
    }

  } catch (e) {
    return url;
  }
}

function compileBatchMatrix(platformEntry, keywords, regions) {
  const results = [];

  for (const keyword of keywords) {
    for (const region of regions) {
      const compiledUrl = compileMatrixUrl(platformEntry, keyword, region);
      results.push({
        keyword,
        region,
        url: compiledUrl,
        domain: platformEntry.domain,
        paradigm: platformEntry.paradigm
      });
    }
  }

  return results;
}

module.exports = {
  compileMatrixUrl,
  compileBatchMatrix,
  substituteKeyword,
  replaceSubdomainRegion,
  replacePathRegion,
  replaceQueryRegion
};
