'use strict';

// $ws_key used to embed minute-grained recency: the busiest minute in the
// workspace's family, then the workspace's own busiest minute. The metadata
// writes are N independent async pane.metadata calls, so between render
// retries one pane could publish the new family token while a sibling still
// reported the old one — Herdr then ranked the two halves apart and split one
// family across two groups. The key is now pure identity (family, depth digit,
// workspace id), identical for every pane of the family on every render,
// regardless of activity.

const test = require('node:test');
const assert = require('node:assert/strict');

const { Frame } = require('../lib/frame');

const entries = ['app', 'feature', 'solo'].map((ws) => ({
  pane: `${ws}:p1`,
  workspace: ws,
  tab: `${ws}:t1`,
  name: 'claude',
  title: 'x',
}));
const parents = new Map([['feature', 'app']]);
const worktrees = new Map([['feature', 'app']]);

test('ws_key is pure identity: family, depth digit, workspace', () => {
  const frame = new Frame('test');
  const { wsKeys } = frame.sortKeys(entries, parents, worktrees);
  assert.equal(wsKeys.get('app'), 'app-1-app', 'the family root carries depth digit 1');
  assert.equal(wsKeys.get('feature'), 'app-0-feature', 'a worktree rides its family with digit 0');
  assert.equal(wsKeys.get('solo'), 'solo-1-solo', 'a standalone workspace is its own family');
});

test('ws_key does not move when pane activity moves', () => {
  const frame = new Frame('test');
  const before = frame.sortKeys(entries, parents, worktrees).wsKeys;
  // A later render sees every pane active at brand-new, distinct minutes — one
  // worktree far busier than the rest of its family. Under the old recency
  // token that changed the family prefix for every member.
  const now = Date.now();
  frame.lastWorkingAt.set('app:p1', now);
  frame.lastWorkingAt.set('feature:p1', now + 10 * 60000);
  frame.lastWorkingAt.set('solo:p1', now + 20 * 60000);
  const after = frame.sortKeys(entries, parents, worktrees).wsKeys;
  assert.deepEqual([...after], [...before], 'the tokens are byte-identical between renders');
});
