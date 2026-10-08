#!/usr/bin/env node
import { runCli } from '../dist/lens/cli.js';
import { sanitizeDisplayText } from '../dist/utils/sanitize.js';
runCli().catch(error => { console.error(`[context-lens] ${sanitizeDisplayText(error.message)}`); process.exitCode = 1; });
