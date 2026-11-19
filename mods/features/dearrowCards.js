// Current TV search and browse screens render lockups outside the legacy shelf response.
import { configRead, configChangeEmitter } from '../config.js';
import { fetchBranding, thumbnailSource } from '../utils/serviceServers.js';

const cardSelector = 'ytlr-playback-preview[role="gridcell"]';
const titleSelector = 'yt-lockup-metadata-view-model > yt-core-attributed-string';
const states = new WeakMap();

function restore(card) {
  const state = states.get(card);
  if (!state) return;
  if (state.title.textContent === state.replacement) state.title.textContent = state.original;
  state.image.style.removeProperty('--tt-dearrow-image');
  state.image.classList.remove('tt-dearrow-image');
  states.delete(card);
}

async function update(card) {
  if (!configRead('enableDeArrow')) { restore(card); return; }
  const title = card.querySelector(titleSelector);
  const image = card.querySelector('thumbnail image');
  const source = image?.style.backgroundImage;
  const match = source?.match(/\/\/i[0-9]*\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//);
  if (!title || !match) { restore(card); return; }
  const id = match[1];
  const old = states.get(card);
  if (old?.source === source && old.title === title && old.image === image && (!old.retryAt || Date.now() < old.retryAt)) {
    if (old.replacement && old.replacement !== old.original && old.original === title.textContent) title.textContent = old.replacement;
    return;
  }
  restore(card);
  const state = { source, title, image, original: title.textContent };
  const retry = () => { state.retryAt = Date.now() + 5000; };
  states.set(card, state);
  const current = () => document.contains(card) && states.get(card) === state && image.style.backgroundImage === source;
  try {
    const data = await fetchBranding(id);
    if (!current() || !data) { retry(); return; }
    const best = data.titles?.[0];
    if (best?.title && !best.original) {
      state.replacement = best.title;
      title.textContent = best.title;
    }
    const thumb = data.thumbnails?.[0];
    if (!configRead('enableDeArrowThumbnails') || thumb?.original || !Number.isFinite(thumb?.timestamp)) return;
    const url = await thumbnailSource(id, thumb.timestamp);
    if (!url || !current()) { retry(); return; }
    const preload = new Image();
    preload.onload = () => {
      if (!current()) return;
      image.style.setProperty('--tt-dearrow-image', 'url(' + JSON.stringify(url) + ')');
      image.classList.add('tt-dearrow-image');
    };
    preload.onerror = retry;
    preload.src = url;
  } catch (_) {
    retry();
  }
}

function watchCards() {
  let visible = new WeakSet();
  const visibility = window.IntersectionObserver && new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        visible.add(entry.target);
        update(entry.target);
      } else visible.delete(entry.target);
    }
  });
  function observe(card) {
    if (!visibility || visible.has(card)) update(card);
    else visibility.observe(card);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(cardSelector)) observe(node);
    Array.from(node.querySelectorAll(cardSelector)).forEach(observe);
  }
  const mutations = new MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      if (record.type === 'attributes' && record.target.localName !== 'image') continue;
      const card = record.target.closest?.(cardSelector);
      if (card) changed.add(card);
      else for (const node of record.addedNodes) scan(node);
      for (const node of record.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(cardSelector)) removed(node);
        Array.from(node.querySelectorAll(cardSelector)).forEach(removed);
      }
    }
    changed.forEach(observe);
  });
  function removed(card) {
    visibility?.unobserve(card);
    visible.delete(card);
    restore(card);
  }
  function refresh() {
    mutations.disconnect();
    visibility?.disconnect();
    visible = new WeakSet();
    Array.from(document.querySelectorAll(cardSelector)).forEach(restore);
    if (!configRead('enableDeArrow')) return;
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    scan(document.body);
  }
  refresh();
  configChangeEmitter.addEventListener('configChange', ({ detail }) => {
    if (['enableDeArrow', 'enableDeArrowThumbnails', 'sponsorBlockServer', 'deArrowThumbnailServer'].includes(detail.key)) refresh();
  });
}

if (document.body) watchCards();
else document.addEventListener('DOMContentLoaded', watchCards);
