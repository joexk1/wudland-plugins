#!/usr/bin/env node
// Codex `notify` program. Codex calls it with one JSON argument after each turn.
// Set WUDLAND_CHAIN_NOTIFY to another notify command to keep using it as well.
import { runCodexNotify } from '../lib/codex.mjs';

runCodexNotify(process.argv[process.argv.length - 1] || '{}');
