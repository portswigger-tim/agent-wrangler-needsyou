#!/usr/bin/env node
// Fails when package-lock.json does not match package.json. Agent Wrangler
// refuses to install an extension that declares dependencies without a lockfile,
// and `npm ci --dry-run` does not detect a stale one, so compare them directly.
import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const declares = FIELDS.some((f) => Object.keys(pkg[f] ?? {}).length);

if (!existsSync('package-lock.json')) {
  if (!declares) process.exit(0);
  console.error('package-lock.json is missing. Run: npm install --package-lock-only --ignore-scripts');
  process.exit(1);
}

const root = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages?.[''] ?? {};
const problems = [];
if (root.name !== pkg.name) problems.push(`name: package.json "${pkg.name}", lockfile "${root.name}"`);
for (const f of FIELDS) {
  const want = pkg[f] ?? {};
  const have = root[f] ?? {};
  for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) {
    if (want[k] !== have[k]) problems.push(`${f}.${k}: package.json ${want[k] ?? '(none)'}, lockfile ${have[k] ?? '(none)'}`);
  }
}

if (problems.length) {
  console.error('package-lock.json is out of sync with package.json:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('Run: npm install --package-lock-only --ignore-scripts');
  process.exit(1);
}
