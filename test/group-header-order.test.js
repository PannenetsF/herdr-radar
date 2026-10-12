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
