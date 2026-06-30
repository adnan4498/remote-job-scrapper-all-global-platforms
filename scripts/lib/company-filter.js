'use strict';

const { aggregatorConfig } = require('../../src/config/platforms');

function normalizeCompanyName(name) {
  if (!name || typeof name !== 'string') return '';

  return name
    .toLowerCase()
    .replace(/[,.;:'"()\[\]{}!?@#$%^&*+=|\\/~`\s-]+/g, '')
    .replace(/inc$|llc$|ltd$|corp$|corporation$|limited$|gmbh$|co$/g, '')
    .trim();
}

function shouldExcludeCompany(companyName) {
  if (!companyName || typeof companyName !== 'string') return false;

  const normalized = normalizeCompanyName(companyName);
  if (!normalized) return false;

  const excluded = aggregatorConfig.excludedCompanies || [];

  for (const blocked of excluded) {
    const normalizedBlocked = normalizeCompanyName(blocked);
    if (!normalizedBlocked) continue;

    if (normalized === normalizedBlocked) {
      return true;
    }

    if (normalized.includes(normalizedBlocked)) {
      return true;
    }

    if (normalizedBlocked.includes(normalized)) {
      return true;
    }
  }

  return false;
}

module.exports = { shouldExcludeCompany, normalizeCompanyName };
