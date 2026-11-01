// Copies the shared lib into each plugin so installed (cached) copies are self-contained.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'claude-code', 'lib');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(root, 'lib'), dest, { recursive: true });
console.log('Copied lib/ to claude-code/lib/');
