import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dir } from './manifest.js';

const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('the launch nudge opens with the end-of-turn trigger (F12)', () => {
  assert.match(read('skills/inbox/WRANGLER.md'), /^Before you end a turn with a question for the human, call `request_human_input`\./);
});

test('the nudge and the skill tell spawners their workers\' questions come to them (F11)', () => {
  const nudge = read('skills/inbox/WRANGLER.md');
  assert.match(nudge, /their questions come to you by mail/);
  assert.match(nudge, /never tell the human a worker will ask them directly/);
  const skill = read('skills/inbox/SKILL.md');
  assert.match(skill, /## If you launch sessions/);
  assert.match(skill, /Never tell the human that a worker will ask them directly/);
});

test('the nudge and the skill send questions about another session\'s request back to it', () => {
  assert.match(read('skills/inbox/WRANGLER.md'), /another session asked it: don't research it yourself/);
  const skill = read('skills/inbox/SKILL.md');
  assert.match(skill, /## When the human asks about a request/);
  assert.match(skill, /\*\*It is not yours:\*\*/);
});
