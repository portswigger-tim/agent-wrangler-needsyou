#!/usr/bin/env node
// Validate this extension against the REAL wrangler loader, the way a boot
// would: discovery (id/dir-name check + the leaf-import scan), validateManifest,
// loadExtensions (name collisions, quarantine reasons), buildHostApi
// (capability names + engines.wranglerApi against the served version), the
// store factory with the bag the wrangler hands it, and the graph keys.
//
//   AW_REPO=<agent-wrangler checkout> node scripts/validate-manifest.mjs
//
// AW_REPO must have `semver` resolvable (npm ci --ignore-scripts there).
// Exits 1 on any refusal, 2 if AW_REPO is not a loader checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = process.env.AW_REPO && path.resolve(process.env.AW_REPO.replace(/^~/, os.homedir()));
if (!repo || !fs.existsSync(path.join(repo, 'server/extensions/index.js'))) {
  console.error('Set AW_REPO to an agent-wrangler checkout that has server/extensions/index.js');
  process.exit(2);
}
// The loader's config-store reads DATA_DIR at import, and so does this
// extension's store: point both somewhere harmless.
process.env.AW_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'needsyou-validate-'));
const mod = (rel) => import(pathToFileURL(path.join(repo, rel)).href);
const { validateManifest, loadExtensions, assertGraphKeys, CAPABILITIES } = await mod('server/extensions/index.js');
const { discoverExternal } = await mod('server/extensions/external.js');
const { buildHostApi, buildExtSettings } = await mod('server/host-api/index.js');
const { HOST_API_VERSION } = await mod('server/host-api/version.js');
let coreToolNames = [], coreHandlerTypes = [];
try { coreToolNames = (await mod('server/mcp/tools/index.js')).TOOLS.map((t) => t.name); } catch (e) { console.warn('(core tool names unavailable:', e.message.split('\n')[0], ')'); }
try { coreHandlerTypes = (await mod('server/control/handlers/index.js')).CONTROL_HANDLERS.map((h) => h.type); } catch (e) { console.warn('(core handler types unavailable:', e.message.split('\n')[0], ')'); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const fail = (msg) => { failed = true; console.error('✗', msg); };
const ok = (msg) => console.log('✓', msg);

// 1. Discovery over an extensions dir holding a COPY named after the id, as an
//    install lays it out (discovery skips symlinks, so a symlink proves nothing).
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'needsyou-ext-'));
const declared = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).wranglerExtension;
fs.cpSync(root, path.join(extDir, declared.id), { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) });
const [found] = await discoverExternal({ dir: extDir, provenance: {} });
if (!found) fail('discoverExternal found nothing');
else if (found.quarantine) fail(`discovery quarantined: ${found.quarantine}`);
else ok(`discovered as "${found.id}" from ${extDir}`);

// 2. The manifest, against the declaration a human consents to.
const { default: manifest } = await import(pathToFileURL(path.join(root, 'server/manifest.js')).href);
try { validateManifest(manifest); ok('validateManifest'); } catch (e) { fail(e.message); }
if (manifest.id !== declared.id) fail(`manifest id "${manifest.id}" != package.json wranglerExtension.id "${declared.id}"`);
if (JSON.stringify(manifest.requires) !== JSON.stringify(declared.requires)) fail('manifest requires != package.json wranglerExtension.requires');
else ok('requires match the disclosed requires');
if (manifest.engines?.wranglerApi !== declared.engines?.wranglerApi) fail('manifest engines.wranglerApi != package.json wranglerExtension.engines.wranglerApi');
for (const c of manifest.requires || []) if (!CAPABILITIES.has(c)) fail(`unknown capability ${c}`);

// 3. The loader, with the core names, so a tool/handler collision is visible.
const loaded = loadExtensions({ cfg: {}, builtin: [{ ...manifest, external: true }], coreToolNames, coreHandlerTypes });
const entry = loaded.list.find((e) => e.id === manifest.id);
if (!entry) fail('loadExtensions produced no entry');
else if (entry.quarantine) fail(`loadExtensions quarantined: ${entry.quarantine}`);
else ok(`loadExtensions: ${loaded.tools.length} tools, ${loaded.handlers.length} handlers [${loaded.handlers.map((h) => h.type).join(', ')}], ${Object.keys(loaded.stores).length} store(s) [${Object.keys(loaded.stores).join(', ')}], ${loaded.sweeps.length} sweep(s), ${entry.settings.length} settings, skills [${entry.skills.join(', ')}], client ${loaded.clientManifest[0]?.client}, styles ${loaded.clientManifest[0]?.styles}`);

// 4. The store factory, with the bag server/index.js hands it.
let store;
try {
  const settings = buildExtSettings({ id: manifest.id, settingDefs: manifest.settings, readSettings: () => ({}) });
  store = manifest.stores.inbox({ id: 'inbox', extId: manifest.id, settings, log: () => {} });
  ok(`store factory → ${store.constructor.name} at ${store.file}, maxOpenPerSession ${store.maxOpenPerSession()}`);
} catch (e) { fail(`store factory threw: ${e.message}`); }

// 5. The façade, and the graph contributor against it, as activation runs it.
try {
  const core = { sessionManager: { activeEntries: () => [], entryFor: () => null }, taskStore: { taskFor: () => null, snapshot: () => ({ tasks: [] }) } };
  const host = buildHostApi({
    id: manifest.id, requires: manifest.requires, range: manifest.engines?.wranglerApi, core,
    rebuild: () => {}, broadcast: () => {}, deliver: async () => ({ mode: 'live' }), archiveSession: () => {},
    stores: store ? { inbox: store } : {}, settingDefs: manifest.settings, readSettings: () => ({}), log: () => {},
  });
  ok(`buildHostApi: serves ${HOST_API_VERSION}, keys [${Object.keys(host).join(', ')}]`);
  const contribution = manifest.graph({ host, graph: {} });
  assertGraphKeys(manifest.id, contribution);
  if (!Array.isArray(contribution.inbox?.items) || contribution.inbox.items.length) fail('graph.inbox.items is not an empty array');
  else ok(`graph keys [${Object.keys(contribution).join(', ')}], inbox.items []`);
} catch (e) { fail(e.message); }

fs.rmSync(extDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
