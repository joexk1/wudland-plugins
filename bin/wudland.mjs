#!/usr/bin/env node
import { main } from '../lib/cli.mjs';

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code ?? 0; },
  (e) => { process.stderr.write(`wudland: ${e.message}\n`); process.exitCode = 1; },
);
