// Screenshot walk-through of every "Needs you" interruption type, against the
// throwaway wrangler e2e/run.sh boots:
//   node e2e/screens.mjs <port> <out dir>
//
// How each interruption is made:
//   - Agent requests (decision, approval, question, action) go through the real
//     /mcp as the card that asks, the same call an agent makes.
//   - Status needs (permission prompt, AskUserQuestion, trust, sign-in, update,
//     container, API error) need a session really waiting, which a card with no
//     process can't be. So the browser's WebSocket is routed and every graph
//     frame it receives has those cards' status rewritten (STATUS below). The
//     board, the real observer, reconcile and the view then run unchanged, so
//     the screenshots show the true end-to-end result.
//
// Safety: nothing here clicks a card or "Open session" (either can resume a
// dormant card and launch a billed agent), and the only answer sent goes to an
// archived card, which core refuses to deliver to.
//
// Exits 1 if a step's expectation fails; the screenshots so far are kept.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const [portArg, outArg] = process.argv.slice(2);
const port = Number(portArg);
if (!port || !outArg) { console.error('usage: node e2e/screens.mjs <port> <out dir>'); process.exit(2); }
const out = path.resolve(outArg);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const VIEW = '#view=ext:needsyou:inbox';

// The status each card shows while its interruption is on. Strings are the
// ones core emits (server/tmux-scraper.js, server/state-reader.js).
const NEEDS = {
  'e2e-perm': { waitingFor: 'Bash: npm publish --access public', waitingReason: null },
  'e2e-ask': { waitingFor: 'input needed', waitingReason: null },
  'e2e-trust': { waitingFor: 'trust dialog', waitingReason: null },
  'e2e-login': { waitingFor: 'Select login method', waitingReason: null },
  'e2e-update': { waitingFor: 'CLI update available, restart to apply', waitingReason: null },
  'e2e-container': { waitingFor: 'container bring-up failed: port 5432 is already in use', waitingReason: null },
  'e2e-apierr': { waitingFor: 'API Error: 401 invalid x-api-key', waitingReason: 'api-error-blocking' },
};
const STATUS = new Map(); // sessionId -> { status, waitingFor, waitingReason }

const failures = [];
const notes = [];
const expect = (ok, what) => {
  if (ok) console.log(`ok: ${what}`);
  else { failures.push(what); console.error(`FAIL: ${what}`); }
  return ok;
};

// ── /mcp as a given card, as an agent calls it ───────────────────────────────
let rpc = 0;
async function ask(caller, args) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-AW-Session': caller },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name: 'request_human_input', arguments: args } }),
  });
  const r = await res.json();
  return { id: r.result?.structuredContent?.id, error: r.result?.isError ? r.result.content?.[0]?.text : r.error?.message };
}

// ── browser ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
let shotNo = 0;
const consoleErrors = [];

async function openBoard({ theme = 'dark', width = 1400, height = 900, scale = 2 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await context.addInitScript((t) => { try { localStorage.setItem('cm-style', t); } catch {} }, theme);
  let toPage = null;
  let lastRaw = null;
  const rewrite = (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return raw; }
    if (m.type !== 'graph' || !m.graph) return raw;
    lastRaw = raw;
    for (const list of [m.graph.sessions, m.graph.nodes]) {
      for (const s of Array.isArray(list) ? list : []) {
        const over = STATUS.get(s.sessionId);
        if (over) Object.assign(s, over, { dormant: false });
      }
    }
    return JSON.stringify(m);
  };
  await context.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    toPage = ws;
    server.onMessage((msg) => ws.send(typeof msg === 'string' ? rewrite(msg) : msg));
    ws.onMessage((msg) => server.send(msg));
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`${base}/`);
  await page.waitForSelector('#nav-rail');
  await page.waitForTimeout(1500);
  // Push the newest graph again with the current STATUS, without waiting for
  // the server's next rebuild.
  const refresh = async () => {
    if (toPage && lastRaw) toPage.send(rewrite(lastRaw));
    await page.waitForTimeout(600);
  };
  return { context, page, refresh };
}

async function shot(page, name, { el, note } = {}) {
  const file = `${String(++shotNo).padStart(2, '0')}-${name}.png`;
  if (el) await page.locator(el).first().screenshot({ path: path.join(out, file) });
  else await page.screenshot({ path: path.join(out, file) });
  notes.push(`${file}${note ? `: ${note}` : ''}`);
  console.log(`shot: ${file}`);
}

const view = (page) => page.evaluate((h) => { location.hash = h; }, VIEW).then(() => page.waitForSelector('.ibx-root'));
const board = (page) => page.evaluate(() => { location.hash = ''; document.querySelector('#nav-rail button[data-view="grid"]')?.click(); }).then(() => page.waitForTimeout(500));
const openRows = (page) => page.locator('.ibx-queue .ibx-row');
const rowTitled = (page, text) => page.locator('.ibx-row', { hasText: text }).first();
const inboxState = (page) => page.evaluate(() => ({
  rows: [...document.querySelectorAll('.ibx-queue .ibx-row .ibx-row-title')].map((e) => e.textContent),
  recent: [...document.querySelectorAll('.ibx-recent-list .ibx-row .ibx-row-title')].map((e) => e.textContent),
}));

try {
  // ── 1. Empty: nothing needs the human ──────────────────────────────────────
  let { context, page, refresh } = await openBoard();
  await shot(page, 'board-empty', { note: 'board, nothing needed: no pills, no rail badge' });
  await view(page);
  await shot(page, 'queue-empty', { note: 'the empty queue' });
  expect(await page.locator('.ibx-next').count() === 0, 'there is no Next button (0.1.3): the n key does its job');

  // ── 2. Every status interruption ───────────────────────────────────────────
  for (const [sid, need] of Object.entries(NEEDS)) STATUS.set(sid, { status: 'needs-you', ...need });
  await refresh();
  await page.waitForFunction((n) => document.querySelectorAll('.ibx-queue .ibx-row').length >= n, Object.keys(NEEDS).length, { timeout: 15_000 })
    .catch(() => {});
  expect(await openRows(page).count() === Object.keys(NEEDS).length, `one status item per needs-you card (${Object.keys(NEEDS).length})`);

  // ── 3. Every agent request kind ────────────────────────────────────────────
  const decision = await ask('e2e-orch', {
    kind: 'decision',
    title: 'Card form: build on Stripe Elements or our own inputs?',
    body: [
      'The payment form worker is ready to start. The choice changes most of its work.',
      '',
      '- **Stripe Elements:** PCI scope stays with Stripe; styling is limited to their theme API.',
      '- **Own inputs:** full control of the design, but we take on SAQ A-EP scope.',
      '',
      '**Recommendation:** Stripe Elements. The design team signed off on its theme.',
    ].join('\n'),
    options: [
      { id: 'elements', label: 'Stripe Elements', description: 'Recommended. Less PCI scope.' },
      { id: 'own', label: 'Our own inputs', description: 'Full design control, more PCI work.' },
    ],
    allow_free_text: true,
    dedupe_key: 'card-form',
  });
  const approval = await ask('e2e-orch', {
    kind: 'approval',
    title: 'Force-push the rebased redesign branch?',
    body: 'I rebased `redesign/checkout` onto `main` to drop the reverted spike. Pushing needs `--force-with-lease`; two other worktrees track this branch.',
    options: [{ id: 'yes', label: 'Force-push' }, { id: 'no', label: "Don't push" }],
    urgency: 'high',
  });
  const action = await ask('e2e-orch', {
    kind: 'action',
    title: 'Approve the GitHub app install on acme/widgets',
    body: 'The deploy preview needs the GitHub app on `acme/widgets`. Open https://github.com/apps/example/installations/new, approve it, then reply **done**.',
    blocking: false,
  });
  for (const [name, r] of Object.entries({ decision, approval, action })) expect(r.id, `${name} request accepted${r.error ? ` (${r.error})` : ''}`);

  // A spawned worker is refused (no item), then allowed from its card menu.
  const refused = await ask('e2e-worker', { kind: 'question', title: 'Which currency formats must the form support?' });
  expect(!refused.id && /launched by another session/.test(refused.error ?? ''), 'the spawned worker is refused');
  notes.push(`(worker refusal text: ${refused.error})`);

  await board(page);
  await refresh();
  await shot(page, 'board-needs', { note: 'board with every interruption: card status, pills, rail badge' });
  await shot(page, 'rail', { el: '#nav-rail', note: 'rail: the person icon and its open-count badge' });
  const permCard = page.locator('[data-sid="e2e-perm"]').first();
  if (await permCard.count()) await shot(page, 'card-status', { el: '[data-sid="e2e-perm"]', note: 'a card in needs-you, with the pill' });
  const orchCard = page.locator('[data-sid="e2e-orch"]').first();
  if (await orchCard.count()) await shot(page, 'card-agent', { el: '[data-sid="e2e-orch"]', note: 'a card with three agent requests (pill count)' });

  // The worker's card menu: allow it to ask.
  const workerCard = page.locator('[data-sid="e2e-worker"]').first();
  if (expect(await workerCard.count() > 0, "the worker's card is on the board")) {
    await workerCard.click({ button: 'right' });
    await page.waitForTimeout(400);
    await shot(page, 'card-menu-worker', { note: "the worker's card menu: one can-ask item, 'Let it ask you directly · asks its orchestrator'" });
    const allow = page.getByText('Let it ask you directly').first();
    if (expect(await allow.count() > 0, 'the card menu offers "Let it ask you directly"')) {
      await allow.click();
      await page.waitForTimeout(800);
      await workerCard.click({ button: 'right' });
      await page.waitForTimeout(400);
      await shot(page, 'card-menu-worker-allowed', { note: "after allowing: one item, 'Send its questions to the orchestrator · asks you directly'" });
      await page.keyboard.press('Escape');
    }
  }
  const question = await ask('e2e-worker', {
    kind: 'question',
    title: 'Which currency formats must the form support?',
    body: 'The brief says "international". Tell me which locales, or I will ship `en-GB`, `en-US` and `de-DE`.',
  });
  expect(question.id, `the allowed worker's question is accepted${question.error ? ` (${question.error})` : ''}`);

  // ── 4. The queue, then each item in turn ───────────────────────────────────
  await view(page);
  await refresh();
  await page.waitForTimeout(500);
  const st = await inboxState(page);
  console.log('queue order:', JSON.stringify(st.rows));
  notes.push(`(queue order: ${st.rows.join(' | ')})`);
  await shot(page, 'queue-full', { note: 'the full queue, first item selected' });
  const q = await page.evaluate(() => [...document.querySelectorAll('.ibx-queue .ibx-row')].map((r) => ({
    label: r.querySelector('.ibx-row-kind-label')?.textContent,
    title: r.querySelector('.ibx-row-title')?.textContent,
    alarm: r.classList.contains('ibx-alarm'),
    status: r.classList.contains('ibx-kind-blocked'),
    urgent: r.querySelector('.ibx-tag-urgent')?.textContent,
  })));
  notes.push(`(queue labels: ${q.map((r) => `${r.label}${r.alarm ? '*' : ''}`).join(' | ')})`);
  const statusLabels = new Set(q.filter((r) => r.status).map((r) => r.label));
  expect(q.filter((r) => r.alarm).length === 2, `only the API error and the container failure are red (${q.filter((r) => r.alarm).map((r) => r.title).join(', ')})`);
  expect(statusLabels.size >= 6, `status items carry their own labels (${[...statusLabels].join(', ')})`);
  // Tier 0 is the status items and urgent requests, oldest first (F4). Here
  // the status needs were raised first, so the approval follows them.
  const forceAt = q.findIndex((r) => /Force-push/.test(r.title));
  const firstNormal = q.findIndex((r) => !r.status && !r.urgent);
  expect(forceAt >= 0 && forceAt < firstNormal && q[forceAt].urgent === 'Urgent',
    `the urgent approval sorts with the blockers, before every other request, tagged (at ${forceAt})`);
  expect(await page.locator('.ibx-detail .ibx-d-title').count() === 1, 'the queue opens on its first item');

  const count = await openRows(page).count();
  for (let i = 0; i < count; i++) {
    const row = openRows(page).nth(i);
    const title = (await row.locator('.ibx-row-title').textContent())?.trim();
    await row.click();
    await page.waitForTimeout(300);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    await shot(page, `item-${slug}`, { note: `detail: "${title}"` });
  }

  // The decision, with an option chosen and a note typed (not sent: its card is live).
  await rowTitled(page, 'Card form').click();
  await page.locator('.ibx-option').nth(1).click();
  const note = page.locator('.ibx-detail-pane .ibx-text');
  if (await note.count()) await note.fill('Fine, but keep the input masks we already have.');
  await page.waitForTimeout(200);
  await shot(page, 'decision-ready-to-send', { note: 'decision with option 2 chosen and a note: what Send would send' });

  // Dismiss asks for confirmation.
  await rowTitled(page, 'GitHub app').click();
  await page.locator('.ibx-detail-pane .ibx-dismiss').first().click();
  await page.waitForTimeout(200);
  await shot(page, 'dismiss-confirm', { note: 'dismiss confirmation' });
  await page.locator('.ibx-confirm-no').first().click();

  // Keyboard: n jumps to the top item (from the top, to the second).
  await page.locator('.ibx-queue .ibx-row').first().click();
  await page.keyboard.press('n');
  await page.waitForTimeout(200);
  await shot(page, 'keyboard-next', { note: 'after pressing n on the top item: the second item selected, focus ring visible' });

  // ── 5. Answering: the archived card, which core refuses to deliver to ─────
  const archived = await ask('e2e-archived', {
    kind: 'approval', title: 'Delete the caching spike branch?', options: [{ id: 'yes', label: 'Delete it' }, { id: 'no', label: 'Keep it' }],
  });
  if (expect(archived.id, 'the archived card can still raise a request (fixture for a failed delivery)')) {
    await refresh();
    await rowTitled(page, 'caching spike').click();
    await page.locator('.ibx-option').first().click();
    await page.locator('.ibx-detail-pane .ibx-send').click();
    await page.waitForTimeout(1500);
    await shot(page, 'answer-failed-delivery', { note: 'answer refused by core (archived card): failed delivery state, retry' });
  }

  // ── 6. Needs clearing on their own → recently resolved ─────────────────────
  STATUS.delete('e2e-perm');
  STATUS.delete('e2e-trust');
  await refresh();
  await page.waitForFunction(() => document.querySelectorAll('.ibx-recent-list .ibx-row').length >= 2, null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'queue-after-clear', { note: 'two status needs cleared: gone from the queue, in recently resolved' });
  const recent = page.locator('.ibx-recent-list .ibx-row').first();
  if (expect(await recent.count() > 0, 'cleared items appear under recently resolved')) {
    await page.locator('.ibx-recent').first().evaluate((d) => { if (d.tagName === 'DETAILS') d.open = true; });
    await recent.click();
    await page.waitForTimeout(300);
    await shot(page, 'resolved-readonly', { note: 'a resolved item: read-only' });
    expect(await page.locator('.ibx-d-readonly button').count() === 0, 'a resolved item has no button row');
  }

  // ── 7. Light theme, the same state ─────────────────────────────────────────
  await context.close();
  ({ context, page, refresh } = await openBoard({ theme: 'light' }));
  await refresh();
  await shot(page, 'light-board', { note: 'light: board' });
  await view(page);
  await refresh();
  await rowTitled(page, 'Card form').click();
  await page.waitForTimeout(300);
  await shot(page, 'light-decision', { note: 'light: decision detail' });
  await rowTitled(page, 'API error').click().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, 'light-api-error', { note: 'light: high-urgency status item' });
  await rowTitled(page, 'caching spike').click().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, 'light-failed-delivery', { note: 'light: the failed delivery, its tag and the archived session named' });
  await context.close();

  // ── 8. Phone width ─────────────────────────────────────────────────────────
  ({ context, page, refresh } = await openBoard({ width: 375, height: 812 }));
  await view(page);
  await refresh();
  await shot(page, 'narrow-list', { note: '375px: the list' });
  await rowTitled(page, 'Card form').click();
  await page.waitForTimeout(300);
  await shot(page, 'narrow-detail', { note: '375px: the detail, with Back' });
  await page.evaluate(() => document.querySelector('.ibx-detail-pane')?.scrollTo(0, 99999));
  await shot(page, 'narrow-detail-bottom', { note: '375px: the detail scrolled to its actions' });
  await context.close();

  // ── 9. The README's screenshot (docs/notes/needs-you.png) ──────────────────
  // 1600 × 825 at 1.25×, small enough for the gate's 1 MB limit. A decision is
  // selected, so it shows the context, the options and the note box.
  // `E2E_README=1 e2e/run.sh` copies it over docs/notes/needs-you.png.
  ({ context, page, refresh } = await openBoard({ width: 1280, height: 660, scale: 1.25 }));
  await view(page);
  await refresh();
  await rowTitled(page, 'Card form').click();
  await page.waitForTimeout(300);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(out, 'readme.png') });
  notes.push('readme.png: the README screenshot (decision selected, Dark)');
  console.log('shot: readme.png');
  await context.close();
} catch (err) {
  failures.push(`walk-through stopped: ${err.message.split('\n')[0]}`);
  console.error(err);
} finally {
  await browser.close();
}

const errs = [...new Set(consoleErrors)];
if (errs.length) notes.push(`(console errors: ${errs.join(' || ')})`);
expect(!errs.length, `no console errors${errs.length ? `: ${errs.join(' || ')}` : ''}`);
fs.writeFileSync(path.join(out, 'INDEX.txt'), `${notes.join('\n')}\n`);
console.log(`e2e: ${shotNo} screenshots in ${out}`);
if (failures.length) { console.error(`e2e: ${failures.length} failed expectation(s)`); process.exit(1); }
