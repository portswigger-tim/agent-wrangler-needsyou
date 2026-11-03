import os from 'node:os';
import path from 'node:path';

// The wrangler's own state dir, resolved the way agent-wrangler resolves it
// (AW_DATA_DIR, else ~/.agent-wrangler). An extension has no data dir of its
// own: its store factory picks the file. Honouring AW_DATA_DIR is what keeps a
// run-dev instance and the test suite (test-setup.js) off the real one.
function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export const DATA_DIR = process.env.AW_DATA_DIR
  ? path.resolve(expandTilde(process.env.AW_DATA_DIR))
  : path.join(os.homedir(), '.agent-wrangler');

// Takes the store-factory bag so a later per-install path can come from it
// without changing the manifest; today the file is fixed.
export function inboxFile(_bag) {
  return path.join(DATA_DIR, 'inbox.json');
}
