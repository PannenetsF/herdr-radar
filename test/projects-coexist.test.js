'use strict';

// Coexistence with herdr-projects. Herdr keeps ONE agents view globally and
// this plugin re-asserts its own on a timer, so while herdr-projects is
// enabled the view we install must be byte-identical to its spec (guest/other
// filter, hp_group/hp_rank order) and the pinned group furniture must predict
// that order: headers keyed by the project slug parsed out of hp_group, not
// by workspace/repo family.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const view = require('../lib/view');
const ipc = require('../lib/ipc');
const { Frame } = require('../lib/frame');

/* ------------------------------------------------------------- hp_group */

test('projectSlug parses tracked keys and rejects unassigned ones', () => {
  assert.equal(state.projectSlug({ hpGroup: 'lagrange-system!0!wT:p1M' }), 'lagrange-system');
  assert.equal(state.projectSlug({ hpGroup: 'lagrange-system!1!2!t-0016' }), 'lagrange-system');
  assert.equal(state.projectSlug({ hpGroup: 'lagrange-system!2!0!w1:p9' }), 'lagrange-system');
  assert.equal(state.projectSlug({ hpGroup: '~!0003' }), null);
  assert.equal(state.projectSlug({ hpGroup: '' }), null);
  assert.equal(state.projectSlug({}), null);
});

test('humanizeSlug title-cases slug parts', () => {
  assert.equal(state.humanizeSlug('lagrange-system'), 'Lagrange System');
  assert.equal(state.humanizeSlug('lg_torch-x'), 'Lg Torch X');
});

test('projectGroups heads and tails follow display order across workspaces', () => {
  const entries = [
    { pane: 'wT:p1M', hpGroup: 'lagrange-system!0!wT:p1M' },
    // A thread living in its own worktree workspace is still the same project.
    { pane: 'wW:p1', hpGroup: 'lagrange-system!1!2!t-0002' },
    { pane: 'wY:p1', hpGroup: 'lagrange-system!1!2!t-0005' },
    { pane: 'wZ:p1', hpGroup: 'other-project!0!wZ:p1' },
    // Unassigned panes belong to no block.
    { pane: 'w1M:p9', hpGroup: '~!0009' },
  ];
  const { heads, tails, paneSlug } = state.projectGroups(entries);
  assert.deepEqual([...heads], ['wT:p1M', 'wZ:p1']);
  assert.deepEqual([...tails], ['wY:p1', 'wZ:p1']);
  assert.equal(paneSlug.get('wY:p1'), 'lagrange-system');
  assert.equal(paneSlug.has('w1M:p9'), false);
});

/* ------------------------------------------------------- writeProjectGroups */

test('writeProjectGroups pins one header per project, members carry nothing', async (t) => {
  const config = require('../lib/config');
  const previousGap = config.groupGap;
  config.groupGap = true;
  t.after(() => {
    config.groupGap = previousGap;
  });
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.push([pane, tokens]);
    return true;
  });
  const entries = [
    { pane: 'h', hpGroup: 'alpha!0!h' },
    { pane: 'm1', hpGroup: 'alpha!1!2!t-1' },
    { pane: 'm2', hpGroup: 'alpha!1!2!t-2' },
  ];
  const { ok } = await state.writeProjectGroups('test', entries, new Map([['alpha', 'Alpha']]));
  assert.equal(ok, true);
  const byPane = new Map(sent);
  assert.equal(byPane.get('h').group, 'Alpha');
  assert.equal(byPane.get('h').gap, null, 'the head is not the last pane here');
  assert.equal(byPane.get('m1').group, null);
  assert.equal(byPane.get('m1').group_parent, null, 'no repo-tree residue');
  assert.equal(byPane.get('m2').group, null);
  assert.equal(byPane.get('m2').gap, '​', 'the last member of the block holds the spacer');
});

test('writeProjectGroups falls back to a humanised slug and fades stale blocks', async (t) => {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.push([pane, tokens]);
    return true;
  });
  const entries = [{ pane: 'h', hpGroup: 'lg-torch!0!h' }];
  await state.writeProjectGroups('test', entries, new Map(), new Set(['lg-torch']));
  const tokens = sent[0][1];
  assert.equal(tokens.group, null);
  assert.equal(tokens.group_stale, 'Lg Torch');
});

/* ------------------------------------------------------------------- view */

test('grouped view carries the projects filter and order only while enabled', async (t) => {
  const sets = [];
  t.mock.method(ipc, 'call', async (method, params) => {
    sets.push([method, params]);
    return { result: { active: true } };
  });
  t.mock.method(herdr, 'projectsEnabled', () => true);
  await view.apply('grouped');
  const [method, params] = sets[0];
  assert.equal(method, 'agent.view.set');
  assert.deepEqual(params.filter, view.PROJECTS_FILTER);
  assert.deepEqual(params.filter.filter.values, ['guest', 'other']);
  assert.deepEqual(params.sort, [
    { field: { token: 'hp_group' }, order: 'asc' },
    { field: { token: 'hp_rank' }, order: 'asc' },
  ]);

  sets.length = 0;
  herdr.projectsEnabled.mock.restore();
  t.mock.method(herdr, 'projectsEnabled', () => false);
  await view.apply('grouped');
  assert.equal(sets[0][1].filter, undefined, 'no filter without the plugin');
  assert.equal(sets[0][1].sort[0].field.token, 'ws_key');
});

test('recent flip keeps the hiding filter while projects is enabled', async (t) => {
  const sets = [];
  t.mock.method(ipc, 'call', async (method, params) => {
    sets.push(params);
    return { result: { active: true } };
  });
  t.mock.method(herdr, 'projectsEnabled', () => true);
  await view.apply('recent');
  assert.deepEqual(sets[0].filter, view.PROJECTS_FILTER);
  assert.deepEqual(sets[0].sort, [{ field: { token: 'sort_key' }, order: 'desc' }]);
});

/* ------------------------------------------------------------- Frame order */

test('Frame.displayOrder sorts tracked panes by hp_group across workspaces', () => {
  const frame = new Frame('test');
  const entries = [
    { pane: 'b1', workspace: 'wY', hpGroup: 'beta!1!2!t-1' },
    { pane: 'a1', workspace: 'wT', hpGroup: 'alpha!0!a1' },
    { pane: 'b2', workspace: 'wW', hpGroup: 'beta!1!2!t-2' },
    { pane: 'u', workspace: 'w1M', hpGroup: '~!0001' },
  ];
  const ranks = { wsKeys: new Map(), minuteKey: () => null, tabKeys: new Map() };
  const got = frame.displayOrder(entries, 'grouped', ranks, true).map((e) => e.pane);
  // Project blocks contiguous regardless of workspace; the unassigned tail
  // sorts last by its own key.
  assert.deepEqual(got, ['a1', 'b1', 'b2', 'u']);
});

test('Frame.groupJobs routes to writeProjectGroups when projects present', async (t) => {
  const calls = [];
  t.mock.method(state, 'writeProjectGroups', async () => {
    calls.push('project-groups');
    return { ok: true };
  });
  t.mock.method(state, 'writeGroups', async () => {
    calls.push('workspace-groups');
    return { ok: true };
  });
  t.mock.method(state, 'clearGroups', async () => ({ ok: true }));
  t.mock.method(state, 'sweepOrphans', async () => true);

  const entries = [
    { pane: 'a1', hpGroup: 'alpha!0!a1' },
    { pane: 'b1', hpGroup: 'beta!1!2!t-1' },
  ];
  const frame = new Frame('test');
  await frame.groupJobs(
    entries,
    entries,
    'grouped',
    true,
    new Map(),
    new Map(),
    {},
    Date.now(),
    [],
    true,
    new Map(),
    new Map(entries.map((e) => [e.pane, 'idle'])),
  );
  assert.deepEqual(calls, ['project-groups']);
});

test('projectDisplayName reads name = from PROJECT.md with caching', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-proj-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previousRoot = process.env.HERDR_PROJECTS_ROOT;
  process.env.HERDR_PROJECTS_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.HERDR_PROJECTS_ROOT;
    else process.env.HERDR_PROJECTS_ROOT = previousRoot;
  });
  fs.mkdirSync(path.join(root, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'demo', 'PROJECT.md'), 'name = "Demo Project"\ngoal = "x"\n');
  assert.equal(herdr.projectDisplayName('demo', 1), 'Demo Project');
  assert.equal(herdr.projectDisplayName('missing', 1), null);
  assert.equal(herdr.projectDisplayName('../etc', 1), null, 'path traversal rejected');
});
