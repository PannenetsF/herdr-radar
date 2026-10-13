'use strict';

// herdr-projects installs its own agents view (sort by hp_group asc, hp_rank
// asc). Herdr keeps ONE view globally with no read-back, so when that plugin
// is enabled radar installs the SAME order and pins group headers for THAT
// order — whichever plugin's view the server holds, the header sits on the
// first pane the sidebar actually draws.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

// Real-world key shapes, copied from herdr-projects' grouping.rs:
// coordinator: "<slug>!0!<pane>", thread: "<slug>!1!<rank>!<id>", unowned: "~!0003".
const e = (pane, workspace, hpGroup, hpRank) => ({
  pane,
  workspace,
  tab: `${workspace}:t-${pane}`,
  name: 'claude',
  title: 'x',
  hpGroup,
  hpRank,
});

function sample() {
  return [
    // snapshot order is workspace-contiguous
    e('wT:p1', 'wT', 'lagrange-system!0!wT:p1', '1'),
    e('wT:p2', 'wT', 'lagrange-system!1!2!t-0002', '2'),
    e('wR:p1', 'wR', 'learning!0!wR:p1', '5'),
    e('wR:p2', 'wR', 'learning!1!4!t-0046', '4'),
    e('wM:p1', 'wM', '~!0014', '1'),
    e('wM:p2', 'wM', '~!0015', '1'),
  ];
}

test('projects order: hp_group then hp_rank ascending, across workspaces', () => {
  const frame = new Frame('test');
  const ordered = frame.displayOrder(
    sample(),
    'grouped',
    { wsKeys: new Map(), tabKeys: new Map(), minuteKey: () => null },
    true,
  );
  assert.deepEqual(
    ordered.map((x) => x.pane),
    ['wT:p1', 'wT:p2', 'wR:p1', 'wR:p2', 'wM:p1', 'wM:p2'],
  );
});

test('headers land on the first DISPLAYED pane of each workspace under projects order', async (t) => {
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    if ('group' in tokens) sent.set(pane, tokens.group);
    return true;
  });
  const entries = sample();
  const frame = new Frame('test');
  const displayEntries = frame.displayOrder(
    entries,
    'grouped',
    { wsKeys: new Map(), tabKeys: new Map(), minuteKey: () => null },
    true,
  );
  const labels = new Map([
    ['wT', 'Lagrange System'],
    ['wR', 'Learning'],
    ['wM', 'nix-hm'],
  ]);
  await state.writeGroups('test', displayEntries, labels);
  assert.equal(sent.get('wT:p1'), 'Lagrange System', 'coordinator (!0) sorts first in wT');
  // Within a project the coordinator key (!0) sorts before every thread (!1),
  // so even a busy rank-4 thread cannot steal its workspace header.
  assert.equal(sent.get('wR:p1'), 'Learning', 'coordinator is always head of its own workspace');
  assert.equal(sent.get('wR:p2'), null, 'the thread is a member, no header');
  assert.equal(sent.get('wM:p1'), 'nix-hm', 'unowned block header on its first displayed pane');
});

test('groupJobs takes projectsPresent into account in the layout fingerprint', async (t) => {
  let writes = 0;
  t.mock.method(state, 'writeGroups', async () => {
    writes += 1;
    return { ok: true };
  });
  t.mock.method(state, 'sweepOrphans', async () => true);
  const entries = sample();
  const frame = new Frame('test');
  const wsAgents = new Map();
  for (const en of entries) wsAgents.set(en.workspace, [{ display: 'idle', name: 'claude' }]);
  const workspaces = new Map(entries.map((en) => [en.workspace, en.workspace]));
  const keys = { parentOf: new Map(), orphanRepo: new Map() };
  // Same entries, same viewMode — but the order model flips: furniture rewrites.
  await frame.groupJobs(entries, entries.slice(), 'grouped', true, wsAgents, workspaces, keys, 0, [], false);
  await frame.groupJobs(entries, entries.slice(), 'grouped', true, wsAgents, workspaces, keys, 0, [], true);
  assert.equal(writes, 2, 'switching order model must rewrite the group furniture');
});

test('projectsEnabled detects an enabled herdr-projects plugin', (t) => {
  t.mock.method(herdr, 'call', (method) => {
    if (method === 'plugin') {
      return { result: { plugins: [{ plugin_id: 'herdr-projects', enabled: true }, { plugin_id: 'other' }] } };
    }
    return null;
  });
  // Cache starts possibly warm from other tests; the mocked call must win by
  // forcing a fresh timestamp past the TTL is not needed across processes, so
  // read directly with a far-future now only when the cache is empty.
  assert.equal(herdr.projectsEnabled(Date.now()), true);
});

test('view.applyGrouped installs the projects-identical spec when enabled', async (t) => {
  let installed;
  const ipc = require('../lib/ipc');
  t.mock.method(herdr, 'projectsEnabled', () => true);
  t.mock.method(ipc, 'call', async (_method, params) => {
    installed = params;
    return { result: { active: true } };
  });
  const reply = await view.applyGrouped();
  assert.ok(reply && !reply.error);
  assert.deepEqual(installed.sort, [
    { field: { token: 'hp_group' }, order: 'asc' },
    { field: { token: 'hp_rank' }, order: 'asc' },
  ]);
});
