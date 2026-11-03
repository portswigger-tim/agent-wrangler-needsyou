import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach } from 'node:test';
import { BrowserWindow, PropertySymbol } from 'happy-dom';

// Loaded via `node --test --import ./test-setup.js`, so it runs before any test
// file in every subprocess. server/data-dir.js resolves DATA_DIR from
// AW_DATA_DIR at import time, so redirecting it here is what keeps every store a
// test builds off the real ~/.agent-wrangler/inbox.json.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-test-'));
process.env.AW_DATA_DIR = dataDir;
process.on('exit', () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// A client test that leaves a happy-dom window or a timer pending would keep
// its file's process alive after its last test. When a top-level test ends,
// every window it made is closed and every timer it set is unref'd (not
// cleared: a library's own timer may still be needed by a later test).
// happy-dom binds globalThis.setTimeout when it loads, after this, so its timers
// count too; a window is caught by the one method its constructor calls.
let depth = 0;
const windows = [];
const timers = [];
const validate = BrowserWindow.prototype[PropertySymbol.validateJavaScriptExecutionEnvironment];
BrowserWindow.prototype[PropertySymbol.validateJavaScriptExecutionEnvironment] = function (...args) {
  if (depth) windows.push(this);
  return validate.apply(this, args);
};
for (const set of ['setTimeout', 'setInterval']) {
  const real = globalThis[set];
  globalThis[set] = function (...args) {
    const timer = real.apply(this, args);
    if (depth) timers.push(timer);
    return timer;
  };
}
beforeEach(() => { depth++; });
afterEach(async () => {
  if (--depth) return;
  for (const w of windows.splice(0)) await w.happyDOM?.close();
  for (const timer of timers.splice(0)) timer.unref?.();
});
