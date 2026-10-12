'use strict';

// The group header is the first pane in the displayed order — the order the
// sidebar draws — not the first in Herdr's snapshot. When the panel is
// grouped, `displayOrder` sorts the entries; a head picked from the snapshot
// order puts the header after the workspace's other panes when they rank
// higher, and they read as part of the previous project group (#49).
//
// The fingerprint only includes heads and tails (not the full pane list), so
// a mid-list pane changing activity does not trigger a rewrite — the header
// stays put until the head or tail itself moves.

const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../lib/state');
const { Frame } = require('../lib/frame');

test('groupBoundaries picks the first pane in the entries order as the head', () => {
  const entries = [
    { pane: 'w:p1', workspace: 'w' },
    { pane: 'w:p2', workspace: 'w' },
  ];
  const { heads, tails } = state.groupBoundaries(entries);
  assert.deepEqual([...heads], ['w:p1']);
  assert.deepEqual([...tails], ['w:p2']);
});

test('writeGroups puts the group token on the first pane in the entries order', async (t) => {
  const herdr = require('../lib/herdr');
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens.group);
    return true;
  });
  const entries = [
    { pane: 'w:p1', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
    { pane: 'w:p2', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
  ];
  const wsLabels = new Map([['w', 'W']]);
  await state.writeGroups('test', entries, wsLabels);
  assert.equal(sent.get('w:p1'), 'W', 'the first pane in herdr order carries the header');
  assert.equal(sent.get('w:p2'), null, 'the other pane has no header');
});

test('groupJobs passes the displayEntries to writeGroups, not the original entries', async (t) => {
  let received;
  t.mock.method(state, 'writeGroups', async (_source, entries) => {
    received = entries;
    return { ok: true };
  });
  t.mock.method(state, 'sweepOrphans', async () => true);
  const entries = [
    { pane: 'w:p1', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
    { pane: 'w:p2', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
  ];
  const displayEntries = [...entries].reverse();
  const frame = new Frame('test');
  await frame.groupJobs(
    entries,
    displayEntries,
    'grouped',
    true,
    new Map([['w', [{ display: 'working', name: 'claude' }]]]),
    new Map([['w', 'W']]),
    { parentOf: new Map(), orphanRepo: new Map() },
    0,
    [],
  );
  assert.equal(received, displayEntries, 'writeGroups received displayEntries, not the original entries');
});

test('groupJobs rewrites when the display order changes', async (t) => {
  let calls = 0;
  t.mock.method(state, 'writeGroups', async () => {
    calls += 1;
    return { ok: true };
  });
  t.mock.method(state, 'sweepOrphans', async () => true);

  const entries = [
    { pane: 'w:p1', workspace: 'w', tab: 't1', name: 'claude', title: 'x' },
    { pane: 'w:p2', workspace: 'w', tab: 't2', name: 'claude', title: 'x' },
    { pane: 'w:p3', workspace: 'w', tab: 't3', name: 'claude', title: 'x' },
    { pane: 'w:p4', workspace: 'w', tab: 't4', name: 'claude', title: 'x' },
  ];
  // Same head (p2) and tail (p4), different mid-list order
  const displayEntries1 = [entries[1], entries[0], entries[2], entries[3]];
  const displayEntries2 = [entries[1], entries[2], entries[0], entries[3]];

  const frame = new Frame('test');
  const wsAgents = new Map([['w', [{ display: 'working', name: 'claude' }]]]);
  const workspaces = new Map([['w', 'W']]);
  const keys = { parentOf: new Map(), orphanRepo: new Map() };

  await frame.groupJobs(entries, displayEntries1, 'grouped', true, wsAgents, workspaces, keys, 0, []);
  await frame.groupJobs(entries, displayEntries2, 'grouped', true, wsAgents, workspaces, keys, 0, []);

  assert.equal(calls, 2, 'writeGroups called twice because display order changed');
});

test('writeGroups clears the old header when the head moves', async (t) => {
  const herdr = require('../lib/herdr');
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens.group);
    return true;
  });

  const entries = [
    { pane: 'w:p1', workspace: 'w', tab: 't1', name: 'claude', title: 'x' },
    { pane: 'w:p2', workspace: 'w', tab: 't2', name: 'claude', title: 'x' },
    { pane: 'w:p3', workspace: 'w', tab: 't3', name: 'claude', title: 'x' },
  ];
  const wsLabels = new Map([['w', 'W']]);

  // First call: p1 is head
  await state.writeGroups('test', entries, wsLabels);
  assert.equal(sent.get('w:p1'), 'W', 'p1 carries the header');
  assert.equal(sent.get('w:p2'), null, 'p2 has no header');

  // Second call: p2 is head (reordered)
  sent.clear();
  const reordered = [entries[1], entries[0], entries[2]];
  await state.writeGroups('test', reordered, wsLabels);
  assert.equal(sent.get('w:p2'), 'W', 'p2 now carries the header');
  assert.equal(sent.get('w:p1'), null, 'p1 old header is cleared');
});
