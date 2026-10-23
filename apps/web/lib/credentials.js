"use strict";
// Saved Liara token (Simple mode, "یادم بماند"). File: <stateDir>/credentials.json, mode 0600 in a 0700 directory.
// Reads and writes never throw to the caller: a broken file means "not saved".

const fs = require("fs");
const path = require("path");

const FILE_NAME = "credentials.json";

function credentialsPath(stateDir) {
  return path.join(stateDir, FILE_NAME);
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort (e.g. filesystems without POSIX modes)
  }
}

/** Returns {token, teamID?} or null. */
function loadCredentials(stateDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsPath(stateDir), "utf8"));
    if (!raw || typeof raw.token !== "string" || raw.token.length === 0) return null;
    return { token: raw.token, ...(typeof raw.teamID === "string" && raw.teamID ? { teamID: raw.teamID } : {}) };
  } catch {
    return null;
  }
}

/** Writes the credentials atomically with mode 0600. Returns true on success. */
function saveCredentials(stateDir, { token, teamID }) {
  try {
    ensurePrivateDir(stateDir);
    const file = credentialsPath(stateDir);
    const tmp = `${file}.${process.pid}.tmp`;
    const body = JSON.stringify({ version: 1, token, ...(teamID ? { teamID } : {}), savedAt: new Date().toISOString() }, null, 2);
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function clearCredentials(stateDir) {
  try {
    fs.rmSync(credentialsPath(stateDir), { force: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = { credentialsPath, loadCredentials, saveCredentials, clearCredentials };
