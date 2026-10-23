#!/usr/bin/env node
// Thin launcher: the compiled CLI lives in build/cli (run `npm run build` first).
require("../../../build/cli/src/main.js").run(process.argv.slice(2));
