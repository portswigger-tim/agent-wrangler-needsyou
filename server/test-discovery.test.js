import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dir } from './manifest.js';

// `npm test` hands node quoted globs (Node >= 21 expands them). A pattern that
// stopped reaching subdirectories would silently skip server/handlers/ and
// server/tools/, so this checks the script's own patterns against every test
// file on disk.
const toRegExp = (glob) => new RegExp(`^${glob.split(/(\*\*\/|\*)/).map((p) => (p === '**/' ? '(?:.*/)?' : p === '*' ? '[^/]*' : p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);

function testFiles(d, out = []) {
  for (const e of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`;
    if (e.isDirectory()) testFiles(rel, out);
    else if (e.name.endsWith('.test.js')) out.push(rel);
  }
  return out;
}

test('the npm test globs reach every test file, nested ones included', () => {
  const script = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.test;
  const globs = [...script.matchAll(/'([^']+)'/g)].map((m) => toRegExp(m[1]));
  assert.ok(globs.length >= 2, script);
  const files = ['server', 'public'].flatMap((d) => testFiles(d));
  assert.ok(files.includes('server/handlers/read.test.js'));
  for (const f of files) assert.ok(globs.some((re) => re.test(f)), `${f} is not matched by ${script}`);
  assert.ok(!globs.some((re) => re.test('server/test-helpers.js')));
});
