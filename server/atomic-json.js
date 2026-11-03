import fs from 'node:fs';
import path from 'node:path';

// Temp file in the SAME dir, then rename: atomic on one filesystem, so a reader
// or the next boot sees the old file or the whole new one, never a torn write.
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// null for a first run (missing or empty file). A file that does not parse, or
// that `accept` refuses, is moved aside as `<file>.corrupt-<ts>` rather than
// overwritten by the next save, logged once, and also reads as null: the store
// must come up, and the bytes stay on disk for repair.
export function readJsonOrQuarantine(file, { now = Date.now, log = () => {}, accept = () => true } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (raw.trim() === '') return null;
  let parsed, reason;
  try {
    parsed = JSON.parse(raw);
    if (!accept(parsed)) reason = 'unexpected shape';
  } catch (err) {
    reason = err.message;
  }
  if (!reason) return parsed;
  const backup = `${file}.corrupt-${now()}`;
  try { fs.renameSync(file, backup); } catch { /* best effort: still come up empty */ }
  log(`${path.basename(file)} could not be read (${reason}); moved it to ${backup} and started empty`);
  return null;
}
