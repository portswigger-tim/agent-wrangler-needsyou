// Seeds a throwaway data dir with the cards the screenshot walk-through needs:
//   node e2e/fixtures.mjs <data dir>
// No card has a process (tmux: null), so nothing is ever launched. The status
// each one shows comes from screens.mjs, which rewrites the graph frames the
// browser receives (see STATUS in screens.mjs).
import fs from 'node:fs';
import path from 'node:path';

export const TASK = { id: 't_e2e', name: 'Checkout redesign' };

// id -> card. Names read like a real board so the screenshots judge real copy.
export const CARDS = {
  'e2e-orch': { name: 'Orchestrator', intent: 'Plan and split the checkout redesign' },
  'e2e-worker': { name: 'Payment form worker', intent: 'Rebuild the payment form', spawnedBy: 'e2e-orch' },
  'e2e-perm': { name: 'Release prep', intent: 'Prepare the 2.4 release' },
  'e2e-ask': { name: 'Schema design', intent: 'Design the orders schema' },
  'e2e-trust': { name: 'New repo setup', intent: 'Bootstrap acme/widgets' },
  'e2e-login': { name: 'Docs refresh', intent: 'Refresh the API docs' },
  'e2e-update': { name: 'Dependency bumps', intent: 'Bump minor versions' },
  'e2e-container': { name: 'Container run', intent: 'Run the suite in a container' },
  'e2e-apierr': { name: 'Big refactor', intent: 'Split the monolith' },
  'e2e-archived': { name: 'Old spike', intent: 'Spike on caching', archived: true },
};

const dir = process.argv[2];
if (dir) {
  const now = Date.now();
  const mappings = {};
  for (const [id, c] of Object.entries(CARDS)) {
    mappings[id] = {
      short: id.slice(4), tmux: null, cwd: null, agent: 'claude', createdAt: now,
      name: c.name, intent: c.intent, archived: Boolean(c.archived),
      ...(c.archived ? { archivedAt: now } : {}),
      ...(c.spawnedBy ? { spawnedBy: c.spawnedBy, parentSession: c.spawnedBy } : {}),
    };
  }
  fs.writeFileSync(path.join(dir, 'mappings.json'), JSON.stringify(mappings));
  const assignments = Object.fromEntries(Object.keys(CARDS).map((id) => [id, TASK.id]));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [TASK], order: [TASK.id, 'adhoc'], assignments, sessionOrder: {} }));
}
