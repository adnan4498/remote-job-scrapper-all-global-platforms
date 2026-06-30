# Plan: URL Pattern Discovery Reconnaissance Engine (scripts/url-finder.js)

## Overview
Build a standalone Node.js reconnaissance script that dynamically probes unknown job board domains, discovers their URL routing paradigm, and outputs a standardized discovered-patterns.json configuration file. This script does NOT scrape jobs -- it only maps URL structures.

---

## Architecture and Module Structure

`
scripts/
  url-finder.js              CLI entry point, orchestration loop
  config/
    target-platforms.js      130+ platform domains to test (seed list)
  lib/
    paradigm-tester.js       5 paradigm test functions with short-circuit
    waf-detector.js          Pre-flight 403/timeout detection -> Tier 4
    url-dissector.js         URL -> pattern blueprint + noise extraction
    result-writer.js         Appends/updates discovered-patterns.json
    constants.js             Keyword, ISO codes, noise patterns, markers
\\n
### Key Dependencies
- axios (already in project) for HTTP probes
- cheerio -- NEW -- lightweight HTML parsing to validate valid layout markers
- Node.js built-in url module for URL dissection
- Node.js built-in fs/promises for JSON read/write

Add cheerio to package.json (npm install cheerio).

---

﻿# Plan: URL Pattern Discovery Reconnaissance Engine (scripts/url-finder.js)

## Overview
Build a standalone Node.js reconnaissance script that dynamically probes unknown job board domains, discovers their URL routing paradigm, and outputs a standardized discovered-patterns.json configuration file. This script does NOT scrape jobs -- it only maps URL structures.

---

## Architecture and Module Structure

scripts/
  url-finder.js              CLI entry point, orchestration loop
  config/
    target-platforms.js      130+ platform domains to test (seed list)
  lib/
    paradigm-tester.js       5 paradigm test functions with short-circuit
    waf-detector.js          Pre-flight 403/timeout detection -> Tier 4
    url-dissector.js         URL -> pattern blueprint + noise extraction
    result-writer.js         Appends/updates discovered-patterns.json
    constants.js             Keyword, ISO codes, noise patterns, markers

### Key Dependencies
- axios (already in project) for HTTP probes
- cheerio -- NEW -- lightweight HTML parsing to validate valid layout markers
- Node.js built-in url module for URL dissection
- Node.js built-in fs/promises for JSON read/write

Add cheerio to package.json (npm install cheerio).
