import { configRead, configWrite } from '../config.js';

const MAX_HIDDEN_VIDEOS = 1000;

function textOf(text) {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (text.simpleText) return text.simpleText;
  if (text.content) return text.content;
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
  const name = textOf(item?.tileRenderer
    ? item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text
    : item?.lockupViewModel?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text).trim();
  const id = findChannelId(item);
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

// Drops tiles of blocked channels and hidden videos from a list of renderer items.
export function removeBlocked(items) {
  if (!Array.isArray(items)) return items;
  const blocked = new Set(configRead('blockedChannels'));
  const hidden = new Set(configRead('hiddenVideos'));
  if (!blocked.size && !hidden.size) return items;
  return items.filter((item) => {
    if (!item?.tileRenderer && !item?.lockupViewModel) return true;
    if (hidden.has(getVideoId(item))) return false;
    if (!blocked.size) return true;
    const channel = getChannelInfo(item);
    if (!channel) return true;
    return !((channel.id && blocked.has(idKey(channel.id)))
      || (channel.name && blocked.has(nameKey(channel.name))));
  });
}
