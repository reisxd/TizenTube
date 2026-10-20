import { configRead, configWrite } from '../config.js';

const MAX_HIDDEN_VIDEOS = 1000;

function textOf(text) {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (text.simpleText) return String(text.simpleText);
  if (text.content) return String(text.content);
  if (Array.isArray(text.runs)) return text.runs.map((run) => run?.text ?? '').join('');
  return '';
}

function findChannelId(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 14) return null;
  const browseId = obj.browseEndpoint?.browseId;
  if (typeof browseId === 'string' && browseId.startsWith('UC')) return browseId;
  for (const value of Object.values(obj)) {
    const id = findChannelId(value, depth + 1);
    if (id) return id;
  }
  return null;
}

export function getVideoId(item) {
  return item?.tileRenderer?.contentId ?? item?.lockupViewModel?.contentId ?? null;
}

// The first metadata line of a video tile is the channel name.
export function getChannelInfo(item) {
  const nameNode = item?.tileRenderer
    ? item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text
    : item?.lockupViewModel?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text;
  const name = textOf(nameNode).trim();
  // Prefer the id attached to the channel name itself over any other id in the tile.
  const id = findChannelId(nameNode) ?? findChannelId(item);
  if (!name && !id) return null;
  return { id, name };
}

const idKey = (id) => `id:${id}`;
const nameKey = (name) => `name:${name.toLowerCase()}`;

export function blockChannel(channel) {
  const key = channel.id ? idKey(channel.id) : nameKey(channel.name);
  const blocked = configRead('blockedChannels');
  if (!blocked.includes(key)) configWrite('blockedChannels', [...blocked, key]);
  configWrite('blockedChannelNames', { ...configRead('blockedChannelNames'), [key]: channel.name || channel.id });
}

export function hideVideoLocally(videoId) {
  const hidden = configRead('hiddenVideos');
  if (!videoId || hidden.includes(videoId)) return;
  configWrite('hiddenVideos', [...hidden, videoId].slice(-MAX_HIDDEN_VIDEOS));
}

function isVideoTile(item) {
  return item?.tileRenderer?.style === 'TILE_STYLE_YTLR_DEFAULT'
    || item?.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO';
}

// Library, history and playlist pages show items the user chose on purpose.
const EXEMPT_PAGES = /FElibrary|FEhistory|FEplaylist|\/playlist|[?&]list=/i;

// Drops video tiles of blocked channels and hidden videos from a list of renderer items.
export function removeBlocked(items) {
  try {
    return filterBlocked(items);
  } catch (err) {
    console.error('TizenTube: failed to filter blocked items:', err);
    return items;
  }
}

function filterBlocked(items) {
  if (!Array.isArray(items)) return items;
  if (EXEMPT_PAGES.test(window.location?.hash ?? '')) return items;
  const blockedKeys = configRead('blockedChannels');
  const hidden = new Set(configRead('hiddenVideos'));
  if (!blockedKeys.length && !hidden.size) return items;
  const blockedIds = new Set(blockedKeys.filter((k) => k.startsWith('id:')));
  const names = configRead('blockedChannelNames');
  const blockedNameOnly = new Set(blockedKeys.filter((k) => k.startsWith('name:')));
  // Names of id-blocked channels, used only for tiles that carry no channel id.
  const blockedIdNames = new Set(blockedKeys.filter((k) => k.startsWith('id:') && names[k]).map((k) => nameKey(names[k])));
  return items.filter((item) => {
    if (!isVideoTile(item)) return true;
    if (hidden.has(getVideoId(item))) return false;
    const channel = getChannelInfo(item);
    if (!channel) return true;
    const nameBlocked = channel.name && (blockedNameOnly.has(nameKey(channel.name))
      || (!channel.id && blockedIdNames.has(nameKey(channel.name))));
    return !(channel.id && blockedIds.has(idKey(channel.id))) && !nameBlocked;
  });
}
