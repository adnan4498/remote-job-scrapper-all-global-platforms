'use strict';

const { URL, URLSearchParams } = require('url');
const { NOISE_QUERY_PARAMS, TARGET_KEYWORD, REGION_CODES } = require('./constants');

function stripNoiseParams(urlObj) {
  const removedParams = [];
  const searchParams = urlObj.searchParams;

  for (const param of NOISE_QUERY_PARAMS) {
    if (searchParams.has(param)) {
      removedParams.push(param);
      searchParams.delete(param);
    }
  }

  urlObj.search = searchParams.toString();
  return { urlObj, removedParams };
}

function safeReverseReplace(pathname, search, keyword, region) {
  let cleanPath = pathname;
  let cleanSearch = search;

  if (cleanPath.includes(keyword)) {
    cleanPath = cleanPath.split(keyword).join('{keyword}');
  }

  const keywordEncoded = encodeURIComponent(keyword);
  if (cleanPath.includes(keywordEncoded)) {
    cleanPath = cleanPath.split(keywordEncoded).join('{keyword}');
  }

  for (const regionCode of REGION_CODES) {
    if (cleanPath.includes(regionCode)) {
      cleanPath = cleanPath.split(regionCode).join('{region}');
    }

    const regionWithDot = `.${regionCode}`;
    if (cleanPath.includes(regionWithDot)) {
      cleanPath = cleanPath.split(regionWithDot).join('.{region}');
    }

    const regionWithDash = `-${regionCode}`;
    if (cleanPath.includes(regionWithDash)) {
      cleanPath = cleanPath.split(regionWithDash).join('-{region}');
    }

    const regionWithSlash = `/${regionCode}`;
    if (cleanPath.includes(regionWithSlash)) {
      cleanPath = cleanPath.split(regionWithSlash).join('/{region}');
    }
  }

  if (cleanSearch.includes(keyword)) {
    cleanSearch = cleanSearch.split(keyword).join('{keyword}');
  }

  if (cleanSearch.includes(keywordEncoded)) {
    cleanSearch = cleanSearch.split(keywordEncoded).join('{keyword}');
  }

  for (const regionCode of REGION_CODES) {
    if (cleanSearch.includes(regionCode)) {
      cleanSearch = cleanSearch.split(regionCode).join('{region}');
    }

    if (cleanSearch.includes(`${regionCode}=`)) {
      cleanSearch = cleanSearch.split(`${regionCode}=`).join('{region}=');
    }

    if (cleanSearch.includes(`=${regionCode}`)) {
      cleanSearch = cleanSearch.split(`=${regionCode}`).join(`={region}`);
    }

    if (cleanSearch.includes(`&${regionCode}`)) {
      cleanSearch = cleanSearch.split(`&${regionCode}`).join(`&{region}`);
    }

    if (cleanSearch.includes(`${regionCode}&`)) {
      cleanSearch = cleanSearch.split(`${regionCode}&`).join(`{region}&`);
    }
  }

  return { pathname: cleanPath, search: cleanSearch };
}

function reconstructTemplate(urlObj, cleanPathname, cleanSearch) {
  const reconstructed = new URL(urlObj.origin + cleanPathname + (cleanSearch ? `?${cleanSearch}` : ''));
  return reconstructed.toString().replace(/\/$/, '');
}

function dissectUrl(finalUrl, originalUrl = null, keyword = TARGET_KEYWORD) {
  try {
    const urlObj = new URL(finalUrl);

    const { urlObj: cleanUrlObj, removedParams } = stripNoiseParams(urlObj);

    const { pathname, search } = safeReverseReplace(
      cleanUrlObj.pathname,
      cleanUrlObj.search,
      keyword,
      REGION_CODES[0]
    );

    const template = reconstructTemplate(cleanUrlObj, pathname, search);

    const activeRegion = detectActiveRegion(finalUrl, REGION_CODES);

    return {
      success: true,
      originalUrl: originalUrl || finalUrl,
      finalUrl,
      template,
      domain: urlObj.hostname,
      noiseParamsRemoved: removedParams,
      activeRegion,
      keyword,
      pathname: urlObj.pathname,
      search: urlObj.search,
      cleanPathname: pathname,
      cleanSearch: search
    };
  } catch (error) {
    return {
      success: false,
      originalUrl: originalUrl || finalUrl,
      finalUrl,
      error: error.message
    };
  }
}

function detectActiveRegion(url, regionCodes) {
  const lowerUrl = url.toLowerCase();
  for (const region of regionCodes) {
    const patterns = [
      `//${region}.`,
      `.${region}/`,
      `/${region}/`,
      `-${region}-`,
      `_${region}_`,
      `=${region}&`,
      `=${region}$`,
      `&${region}=`,
      `?${region}=`
    ];

    for (const pattern of patterns) {
      if (lowerUrl.includes(pattern.toLowerCase())) {
        return region;
      }
    }
  }
  return null;
}

function dissectRedirectChain(redirectUrls, originalUrl, keyword = TARGET_KEYWORD) {
  if (!redirectUrls || redirectUrls.length === 0) {
    return dissectUrl(originalUrl, originalUrl, keyword);
  }

  const finalUrl = redirectUrls[redirectUrls.length - 1];
  return dissectUrl(finalUrl, originalUrl, keyword);
}

module.exports = {
  dissectUrl,
  dissectRedirectChain,
  stripNoiseParams,
  safeReverseReplace,
  reconstructTemplate,
  detectActiveRegion
};