import { configRead } from '../config.js';

export const defaultServers = {
  sponsorBlockServer: 'https://sponsor.ajay.app',
  deArrowThumbnailServer: 'https://dearrow-thumb.ajay.app'
};

function nativeClient() {
  const client = window.TizenTubeServers;
  return typeof client?.selectedServer === 'function' ? client : null;
}

export function serverSelection(key) {
  const client = nativeClient();
  const approved = client?.selectedServer(key);
  const value = approved ?? configRead(key);
  return { value, pending: !!client && approved == null && !!value };
}

export function normalizeServer(value) {
  const base = value.trim();
  if (!base) return '';
  if (!/^https?:\/\/[^/]/i.test(base) || /[\s\\?#]/.test(base)) return null;
  try {
    const url = new URL(base);
    if (url.username || url.password) return null;
    return url.href.replace(/\/+$/, '');
  } catch (_) {
    return null;
  }
}

// The Android host delivers replies to the YouTube main frame. Other hosts use fetch.
const pending = new Map();
let sequence = 0;
const session = Math.random().toString(36).slice(2);
window.addEventListener('message', event => {
  if (!pending.size || event.origin !== location.origin || typeof event.data !== 'string') return;
  let reply;
  try { reply = JSON.parse(event.data); } catch (_) { return; }
  pending.get(reply?.tizenTubeRequest)?.(reply.value);
});

function nativeRequest(method, args) {
  const id = session + '-' + (++sequence);
  return new Promise(resolve => {
    const finish = value => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), method === 'configure' ? 120000 : 30000);
    pending.set(id, finish);
    try { window.TizenTubeServers[method](id, ...args); } catch (_) { finish(null); }
  });
}

export function confirmServer(key, base) {
  return nativeClient() ? nativeRequest('configure', [key, base]) : Promise.resolve(true);
}

// The bundled XHR-based fetch polyfill follows redirects even with redirect: 'error'.
const supportsRedirectPolicy = typeof Request !== 'undefined' && 'redirect' in Request.prototype;

async function request(key, method, args, path) {
  const { value, pending } = serverSelection(key);
  const image = key === 'deArrowThumbnailServer';
  if (pending) return null;
  if (value && nativeClient()) {
    const result = await nativeRequest(method, args);
    return result && !image ? JSON.parse(result) : result;
  }
  const url = (value || defaultServers[key]) + path;
  if (image && !value) return url;
  if (value && !supportsRedirectPolicy) return null;
  const response = await fetch(url, value ? { redirect: 'error', credentials: 'omit' } : undefined);
  if (!response.ok) return null;
  if (!image) return response.json();
  const blob = await response.blob();
  if (!/^image\/(jpeg|png|webp|avif)$/i.test(blob.type)) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function fetchSegments(prefix) {
  const categories = ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'preview', 'filler', 'music_offtopic', 'poi_highlight'];
  return request('sponsorBlockServer', 'segments', [prefix],
    '/api/skipSegments/' + prefix + '?categories=' + encodeURIComponent(JSON.stringify(categories)));
}

export function fetchBranding(id) {
  return request('sponsorBlockServer', 'branding', [id], '/api/branding?videoID=' + encodeURIComponent(id));
}

export function thumbnailSource(id, time) {
  return request('deArrowThumbnailServer', 'thumbnail', [id, String(time)],
    '/api/v1/getThumbnail?videoID=' + encodeURIComponent(id) + '&time=' + time);
}
