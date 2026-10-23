"use strict";
// Last deployed site, remembered in <stateDir>/site.json so the Simple page can show it after a restart.

const fs = require("fs");
const path = require("path");

const FILE_NAME = "site.json";

function sitePath(stateDir) {
  return path.join(stateDir, FILE_NAME);
}

/** Returns {appName, url, planID?, bundlePlanID?, monthlyTomans?, lastDeployAt} or null. */
function readSite(stateDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(sitePath(stateDir), "utf8"));
    if (!raw || typeof raw.appName !== "string" || typeof raw.url !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

function writeSite(stateDir, site) {
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(sitePath(stateDir), `${JSON.stringify(site, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { sitePath, readSite, writeSite };
