import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.window = { location: { hash: '#/' }, localStorage: store, dispatchEvent() {} };
globalThis.CustomEvent = class {};

const { configWrite, configRead } = await import('../config.js');
const { getChannelInfo, getVideoId, blockChannel, hideVideoLocally, removeBlocked } = await import('../utils/blocklist.js');

const tile = (id, channel, ucId) => ({
  tileRenderer: {
    style: 'TILE_STYLE_YTLR_DEFAULT',
    contentId: id,
    metadata: { tileMetadataRenderer: { lines: [{ lineRenderer: { items: [{ lineItemRenderer: {
      text: { runs: [{ text: channel, navigationEndpoint: ucId ? { browseEndpoint: { browseId: ucId } } : undefined }] }
    } }] } }] } }
  }
});
const lockup = (id, channel) => ({
  lockupViewModel: {
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentId: id,
    metadata: { lockupMetadataViewModel: { metadata: { contentMetadataViewModel: {
      metadataRows: [{ metadataParts: [{ text: { content: channel } }] }]
    } } } }
  }
});
const ids = (items) => items.map((i) => i.tileRenderer?.contentId ?? i.lockupViewModel?.contentId ?? 'other');

beforeEach(() => {
  configWrite('blockedChannels', []);
  configWrite('blockedChannelNames', {});
  configWrite('hiddenVideos', []);
});

test('getVideoId reads tiles and lockups', () => {
  assert.equal(getVideoId(tile('a', 'Foo')), 'a');
  assert.equal(getVideoId(lockup('b', 'Foo')), 'b');
  assert.equal(getVideoId({ shelfHeader: 1 }), null);
});

test('getChannelInfo: name from tile and lockup, id only when present', () => {
  assert.deepEqual(getChannelInfo(tile('a', 'Foo', 'UC1')), { id: 'UC1', name: 'Foo' });
  assert.deepEqual(getChannelInfo(tile('a', 'Foo')), { id: null, name: 'Foo' });
  assert.deepEqual(getChannelInfo(lockup('c', 'Baz')), { id: null, name: 'Baz' });
  assert.equal(getChannelInfo({ shelfHeader: 1 }), null);
});

test('blocking by id removes only that channel', () => {
  blockChannel({ id: 'UC1', name: 'Foo' });
  const out = removeBlocked([tile('x1', 'Foo', 'UC1'), tile('x2', 'Foo', 'UC2'), tile('x3', 'Other')]);
  assert.deepEqual(ids(out), ['x2', 'x3']);
});

test('blocking by name (no id) matches tiles and lockups, case-insensitively', () => {
  blockChannel({ id: null, name: 'Baz' });
  const out = removeBlocked([lockup('c', 'baz'), tile('d', 'Other')]);
  assert.deepEqual(ids(out), ['d']);
});

test('hidden videos are removed, others kept', () => {
  hideVideoLocally('b');
  assert.deepEqual(ids(removeBlocked([tile('a', 'Foo'), tile('b', 'Bar')])), ['a']);
});

test('non-video items are never filtered', () => {
  blockChannel({ id: null, name: 'Foo' });
  assert.deepEqual(ids(removeBlocked([{ shelfHeader: 1 }, tile('a', 'Foo')])), ['other']);
});

test('unblocking (editing the config list) restores videos', () => {
  blockChannel({ id: 'UC1', name: 'Foo' });
  configWrite('blockedChannels', []);
  assert.deepEqual(ids(removeBlocked([tile('x1', 'Foo', 'UC1')])), ['x1']);
});

test('hidden video list is capped', () => {
  for (let i = 0; i < 1100; i++) hideVideoLocally('v' + i);
  assert.equal(configRead('hiddenVideos').length, 1000);
});
