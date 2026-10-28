// Publishes YouTube rows (Home shelves, Subscriptions, History, ...) and Continue Watching
// to the Android TV home screen, for launchers that show app channels (Projectivy, the stock
// Android TV launcher). The native side (window.h5vcc.tizentube.PublishHomeScreen) owns the
// TvProvider work; this file only gathers cards and watch progress.
//
// Payload (v1), all fields optional except v:
//   { v: 1, account: '<hash>', clear: bool,
//     rows: [{ key, title, items: [Card] | null }],   // full set of rows; items null = leave as is
//     watchNext: [{ id, title, subtitle, thumb, duration, position, engagedAt }] }

import { configRead, configChangeEmitter } from '../config.js';
import { onPlayer } from '../utils/Player.js';
import { shelvesOf, continuationOf, tidy, channelCardOf } from '../utils/homeScreenParse.js';
import { classifyShelves, enoughShelves, assignSlots, slotTitle, mergeTopChannels, rankChannels, keyOf } from '../utils/homeScreenShelves.js';
import sha256 from '../tiny-sha256.js';
import { t } from 'i18next';

const LOG = '[HomeScreen]';
const STORE_KEY = 'tt-home-screen-state';
const RESUME_MIN_MS = 15 * 60 * 1000;
const MAX_HOME_PAGES = 5;
const AFTER_WATCH_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;
const MAX_PAGES = 4;

// Watch Next rules from Google's Android TV guidance, plus a length floor so short clips stay out.
const WN_MAX = 10;
const WN_MIN_LENGTH = 10 * 60;
const WN_STARTED_SECONDS = 2 * 60;
const WN_STARTED_FRACTION = 0.03;
const WN_FINISHED_REMAINING = 3 * 60;
const WN_KEEP_DAYS = 30;
const MAX_LOCAL = 100;
const MAX_SEEN = 400;
const MAX_HISTORY = 30;
const MAX_VARIABLE_ROWS = 5;
const CHANNEL_INFO_DAYS = 7;
const CHANNEL_LOOKUPS_PER_REFRESH = 6;

// Row keys never change, so launchers keep each row's place and the user's choice to show it.
const KEY = { recommended: 'home_0', recentlyUploaded: 'home_1', topChannels: 'home_2' };
const variableKey = i => 'home_' + (3 + i);
// Order rows are created in, which is the order a launcher first lists them.
const ROW_ORDER = ['recommended', 'recentlyUploaded', 'live', 'subscriptions', 'fresh', 'history', 'watchLater', 'topChannels', 'home'];

// Present in TizenTube Cobalt builds with home screen support; only TVs have a home screen to fill.
let supported = null;
export function homeScreenSupported() {
    if (supported !== null) return supported;
    const tt = window.h5vcc && window.h5vcc.tizentube;
    if (!tt || !tt.PublishHomeScreen) return (supported = false);
    try {
        supported = !tt.HasSystemFeature || !!tt.HasSystemFeature('android.software.leanback');
    } catch (_) {
        supported = true;
    }
    return supported;
}
const native = homeScreenSupported;

let busy = false;
let pending = null;         // a refresh asked for while one was running
let lastFull = 0;
let lastRows = {};          // key -> items, reused when a fetch fails
let afterWatchTimer = null;
let player = null;

// ---------- small persistent state (progress, History progress, first-seen times, account) ----------

function emptyState(account) {
    return { local: {}, server: {}, seen: {}, history: [], slots: [], top: { entries: [] }, channels: {}, account };
}

function loadState() {
    try {
        const s = JSON.parse(window.localStorage[STORE_KEY] || '{}');
        return {
            local: s.local || {}, server: s.server || {}, seen: s.seen || {}, history: s.history || [],
            slots: s.slots || [], top: s.top || { entries: [] }, channels: s.channels || {}, account: s.account || ''
        };
    } catch (_) {
        return emptyState('');
    }
}

function saveState(s) {
    // Keeps the newest n entries; `time` reads an entry's timestamp.
    const cap = (map, n, time) => {
        const keys = Object.keys(map).sort((a, b) => time(map[b]) - time(map[a]));
        for (const k of keys.slice(n)) delete map[k];
    };
    cap(s.local, MAX_LOCAL, e => e.at);
    cap(s.server, MAX_LOCAL, e => e.at);
    cap(s.seen, MAX_SEEN, e => e);
    try { window.localStorage[STORE_KEY] = JSON.stringify(s); } catch (_) { }
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}

// ---------- InnerTube ----------

function services() {
    const mappings = window._yttv && Object.values(window._yttv).find(a => a && a.mappings);
    if (!mappings) return null;
    return { identity: mappings.get('CurrentIdentityService'), client: mappings.get('KabukiInnerTubeClient') };
}

function browse(svc, identity, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS);
        try {
            svc.client.fetch({
                identity,
                isPrefetch: false,
                path: '/youtubei/v1/browse',
                payload,
                clickTracking: { clickTrackingParams: null }
            }).subscribe(
                (response) => { clearTimeout(timer); resolve(response); },
                (err) => { clearTimeout(timer); reject(err || new Error('fetch failed')); }
            );
        } catch (e) {
            clearTimeout(timer);
            reject(e);
        }
    });
}

// A feed flattened to cards, following continuations until `want` cards or MAX_PAGES.
async function feed(svc, identity, browseId, want, filter) {
    let response = await browse(svc, identity, { browseId });
    let cards = [];
    for (let page = 0; ; page++) {
        for (const shelf of shelvesOf(response)) {
            // Feeds made of shelves (five cards each on TV) grow each shelf before the next page.
            if (tidy(cards.concat(shelf.cards.filter(filter))).length < want) await grow(svc, identity, shelf, want - cards.length);
            cards = tidy(cards.concat(shelf.cards.filter(filter)));
        }
        const token = continuationOf(response);
        if (cards.length >= want || !token || page + 1 >= MAX_PAGES) break;
        response = await browse(svc, identity, { continuation: token });
    }
    return cards;
}

// Fetches more of a shelf's cards (TV shelves come five at a time) until it has `want`.
// Adds to shelf.cards in place, so anything already holding the array sees the new cards.
async function grow(svc, identity, shelf, want) {
    let token = shelf.next;
    for (let page = 0; token && tidy(shelf.cards).length < want && page < MAX_PAGES; page++) {
        const response = await browse(svc, identity, { continuation: token });
        for (const more of shelvesOf(response)) for (const c of more.cards) shelf.cards.push(c);
        token = continuationOf(response);
    }
    shelf.next = token;
}

// Stable across sessions for one signed-in account; changes when the account or profile does.
function accountKey(identity) {
    if (!identity || typeof identity !== 'object') return 'guest';
    const preferred = ['onBehalfOfUser', 'delegatedSessionId', 'pageId', 'datasyncId', 'obfuscatedGaiaId', 'gaiaId'];
    let parts = preferred.filter(k => identity[k]).map(k => k + '=' + identity[k]);
    if (!parts.length) {
        parts = Object.keys(identity).sort()
            .filter(k => /^(string|number|boolean)$/.test(typeof identity[k]) && !/token|expir|time|nonce|auth/i.test(k))
            .map(k => k + '=' + identity[k]);
    }
    return parts.length ? sha256(parts.join('&')).slice(0, 16) : 'guest';
}

// ---------- rows ----------

const isVideo = c => c.type === 'video';
const rowTitle = key => t('settings.options.homeScreen.rows.' + key);

function publicCard(c) {
    const out = { type: c.type, id: c.id, title: c.title, subtitle: c.subtitle, thumb: c.thumb };
    if (c.playlistId) out.playlistId = c.playlistId;
    if (c.duration) out.duration = c.duration;
    if (c.live) out.live = true;
    if (c.progress) out.progress = c.progress;
    return out;
}

async function buildRows(svc, identity, state) {
    const sources = configRead('homeScreenSources') || [];
    const size = configRead('homeScreenRowSize');
    const shorts = configRead('enableHomeScreenShorts');
    const byKind = {};
    const keep = (kind, key, title, cards) => {
        const items = cards ? tidy(cards, { noShorts: !shorts }).slice(0, size).map(publicCard) : (lastRows[key] || null);
        if (cards) lastRows[key] = items;
        (byKind[kind] = byKind[kind] || []).push({ key, title, items });
    };
    const attempt = async (label, fn) => {
        try { return await fn(); } catch (e) { console.warn(LOG, label, 'failed:', e && e.message); return null; }
    };

    let topShelf = null;
    const wantHome = ['recommended', 'recentlyUploaded', 'topChannels', 'home'].some(s => sources.includes(s));
    if (wantHome) {
        const count = Math.min(MAX_VARIABLE_ROWS, Math.max(0, configRead('homeScreenHomeShelves')));
        const sorted = await attempt('home', () => homeShelves(svc, identity, count, shorts));
        if (sorted) {
            const fixed = [sources.includes('recommended') && sorted.recommended, sources.includes('recentlyUploaded') && sorted.recentlyUploaded];
            await Promise.all(fixed.filter(Boolean).map(s => attempt('more cards', () => grow(svc, identity, s, size))));
        }
        if (sources.includes('recommended')) {
            keep('recommended', KEY.recommended, rowTitle('recommended'), sorted && sorted.recommended ? sorted.recommended.cards : null);
        }
        if (sources.includes('recentlyUploaded')) {
            keep('recentlyUploaded', KEY.recentlyUploaded, rowTitle('recentlyUploaded'), sorted && sorted.recentlyUploaded ? sorted.recentlyUploaded.cards : null);
        }
        topShelf = sorted && sorted.topChannels ? sorted.topChannels.cards.filter(c => c.type === 'channel') : null;
        if (sources.includes('home') && count > 0) {
            if (sorted) {
                state.slots = assignSlots(state.slots, sorted.variable, count);
                const used = {};
                for (const slot of state.slots) if (slot.cards) used[slot.key] = true;
                await Promise.all(sorted.variable.filter(s => used[keyOf(s)]).map(s => attempt('more cards', () => grow(svc, identity, s, size))));
            }
            const slots = state.slots || [];
            for (let i = 0; i < count; i++) {
                const slot = slots[i];
                keep('home', variableKey(i), slotTitle(slot, rowTitle('variable' + (i + 1))), slot && slot.cards ? slot.cards : null);
            }
        }
    }

    const needSubs = ['subscriptions', 'fresh', 'live', 'topChannels'].some(s => sources.includes(s));
    const subs = needSubs ? await attempt('subscriptions', () => feed(svc, identity, 'FEsubscriptions', Math.max(size, 60), isVideo)) : null;
    if (sources.includes('subscriptions')) keep('subscriptions', 'subscriptions', rowTitle('subscriptions'), subs);
    if (sources.includes('fresh')) keep('fresh', 'fresh', rowTitle('fresh'), subs ? freshOf(subs, state) : null);
    if (sources.includes('live')) keep('live', 'live', rowTitle('live'), subs ? subs.filter(c => c.live) : null);

    const needHistory = sources.includes('history') || sources.includes('topChannels') || configRead('enableHomeScreenWatchNext');
    const historyWant = Math.max(size, sources.includes('topChannels') ? 60 : 30);
    const history = needHistory ? await attempt('history', () => feed(svc, identity, 'FEhistory', historyWant, isVideo)) : null;
    // Kept with the state so Continue Watching survives restarts and failed fetches.
    if (history) state.history = history.filter(c => c.progress > 0 && c.duration && !c.shorts).slice(0, MAX_HISTORY)
        .map(c => ({ id: c.id, title: c.title, subtitle: c.subtitle, thumb: c.thumb, duration: c.duration, progress: c.progress }));
    if (sources.includes('history')) keep('history', 'history', rowTitle('history'), history);

    if (sources.includes('topChannels')) {
        // YouTube's own "Top channels" shelf leads when Home has it; the channels you watch most in
        // History fill in, so the row has channels even when the shelf doesn't turn up.
        const ranked = history || subs ? await rankedChannelCards(svc, identity, state, history, subs, size) : null;
        const lead = topShelf || ranked ? tidy((topShelf || []).concat(ranked || [])) : null;
        const top = mergeTopChannels(state.top, lead, Date.now());
        state.top = top.store;
        // Always sent (never "keep as is"), so the row only ever holds channels.
        keep('topChannels', KEY.topChannels, rowTitle('topChannels'), top.cards);
    }

    if (sources.includes('watchLater')) {
        keep('watchLater', 'watch_later', rowTitle('watchLater'), await attempt('watch later', () => feed(svc, identity, 'VLWL', size, isVideo)));
    }
    return ROW_ORDER.reduce((rows, kind) => rows.concat(byKind[kind] || []), []);
}

// Channel cards for the channels you watch most. Names and avatars come from each channel's page,
// looked up a few at a time and kept for a week.
async function rankedChannelCards(svc, identity, state, history, subs, limit) {
    const now = Date.now();
    const cache = state.channels || {};
    let lookups = 0;
    const cards = [];
    for (const ch of rankChannels(history, limit, subs)) {
        let hit = cache[ch.id];
        if ((!hit || now - hit.at > CHANNEL_INFO_DAYS * 86400000) && lookups < CHANNEL_LOOKUPS_PER_REFRESH) {
            lookups++;
            try {
                const card = channelCardOf(await browse(svc, identity, { browseId: ch.id }), ch.id);
                if (card) hit = cache[ch.id] = { card, at: now };
            } catch (e) {
                console.warn(LOG, 'channel lookup failed:', e && e.message);
            }
        }
        if (hit) cards.push(hit.card);
    }
    for (const id of Object.keys(cache)) if (now - cache[id].at > 4 * CHANNEL_INFO_DAYS * 86400000) delete cache[id];
    state.channels = cache;
    return cards;
}

// Home shelves, following Home's pages until the rows have what they need. Shelves left empty
// once Shorts are taken out (when they're off) don't count.
async function homeShelves(svc, identity, variableCount, shorts) {
    let response = await browse(svc, identity, { browseId: 'default' });
    let shelves = [];
    let sorted = null;
    for (let page = 0; ; page++) {
        shelves = shelves.concat(shelvesOf(response).filter(s => tidy(s.cards, { noShorts: !shorts }).length > 0));
        sorted = classifyShelves(shelves);
        // The page's own token, not one of a shelf's (those only add cards to that shelf).
        const pageShelves = shelvesOf(response);
        let token = continuationOf(response);
        if (pageShelves.some(s => s.next === token)) token = null;
        if (enoughShelves(sorted, variableCount) || !token || page + 1 >= MAX_HOME_PAGES) break;
        response = await browse(svc, identity, { continuation: token });
    }
    console.info(LOG, 'home shelves:', shelves.map(s => s.title || '(untitled)').join(' | '));
    return sorted;
}

// Uploads inside the chosen window. English pages give an age ("3 hours ago"); other languages
// fall back to when this app first saw the video in Subscriptions.
function freshOf(subs, state) {
    const windowSec = configRead('homeScreenFreshHours') * 3600;
    const now = Date.now();
    const firstRun = Object.keys(state.seen).length === 0;
    for (const c of subs) if (!state.seen[c.id]) state.seen[c.id] = firstRun ? 1 : now;
    const ages = subs.some(c => c.age >= 0);
    return subs.filter(c => !c.live && (ages
        ? c.age >= 0 && c.age <= windowSec
        : state.seen[c.id] > 1 && now - state.seen[c.id] <= windowSec * 1000));
}

// ---------- Watch Next ----------

// Merges this device's own positions with YouTube's History progress, newest engagement wins.
function watchNextOf(state) {
    const now = Date.now();
    const oldest = now - WN_KEEP_DAYS * 86400000;
    const firstRun = Object.keys(state.server).length === 0;
    const byId = {};

    (state.history || []).forEach((c, index) => {
        const position = Math.round(c.duration * c.progress / 100);
        const prev = state.server[c.id];
        // History has no dates. On the very first run, space its entries an hour apart so old
        // half-watched videos don't jump ahead of other apps; later arrivals are recent.
        // A changed percentage means it was watched again (maybe on another device).
        const at = !prev ? now - (index + 1) * (firstRun ? 3600000 : 1000) : prev.pct !== c.progress ? now : prev.at;
        state.server[c.id] = { pct: c.progress, at };
        byId[c.id] = { id: c.id, title: c.title, subtitle: c.subtitle, thumb: c.thumb, duration: c.duration, position, engagedAt: at };
    });

    for (const id of Object.keys(state.local)) {
        const l = state.local[id];
        if (l.at < oldest) { delete state.local[id]; continue; }
        const s = byId[id];
        const sameSession = s && Math.abs(s.position - l.position) <= Math.max(60, l.duration * 0.02);
        if (!s || l.at >= s.engagedAt || sameSession) {
            byId[id] = {
                id, title: l.title || (s && s.title) || '', subtitle: l.subtitle || (s && s.subtitle) || '',
                thumb: (s && s.thumb) || 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
                duration: l.duration, position: l.position, engagedAt: Math.max(l.at, s ? s.engagedAt : 0),
                finished: l.finished
            };
        }
    }

    return Object.values(byId)
        .filter(w => w.title && !w.finished && w.engagedAt >= oldest && w.duration >= WN_MIN_LENGTH &&
            (w.position >= WN_STARTED_SECONDS || w.position >= w.duration * WN_STARTED_FRACTION) &&
            w.duration - w.position >= WN_FINISHED_REMAINING)
        .sort((a, b) => b.engagedAt - a.engagedAt)
        .slice(0, WN_MAX)
        .map(w => ({ id: w.id, title: w.title, subtitle: w.subtitle, thumb: w.thumb, duration: w.duration, position: w.position, engagedAt: w.engagedAt }));
}

function recordPlayback(ended) {
    try {
        const data = player && player.getVideoData && player.getVideoData();
        const id = data && data.video_id;
        if (!id || data.isLive) return false;
        const stats = player.getVideoStats ? Object.values(player.getVideoStats()) : [];
        if (stats.indexOf('shortspage') !== -1) return false;
        const duration = Math.round(player.getDuration ? player.getDuration() : 0);
        const position = Math.round(player.getCurrentTime ? player.getCurrentTime() : 0);
        if (!duration || duration < WN_MIN_LENGTH) return false;
        const state = loadState();
        const prev = state.local[id];
        if (!ended && prev && Math.abs(prev.position - position) < 5) return false;
        state.local[id] = {
            position, duration, at: Date.now(),
            title: data.title || '', subtitle: data.author || '',
            finished: ended || duration - position < WN_FINISHED_REMAINING
        };
        saveState(state);
        return true;
    } catch (e) {
        console.warn(LOG, 'progress not recorded:', e && e.message);
        return false;
    }
}

// ---------- publishing ----------

const enabled = () => native() && configRead('enableHomeScreenRows');

function send(payload) {
    try {
        window.h5vcc.tizentube.PublishHomeScreen(JSON.stringify(payload));
    } catch (e) {
        console.warn(LOG, 'publish failed:', e && e.message);
    }
}

async function refresh(reason, force, onDone) {
    if (!enabled()) return;
    if (busy) {
        // Run once more when this one ends, so a settings change or button press is never lost.
        pending = { reason, force: force || (pending && pending.force), onDone: onDone || (pending && pending.onDone) };
        return;
    }
    if (!force && Date.now() - lastFull < Math.min(RESUME_MIN_MS, refreshEveryMs())) return;
    const svc = services();
    if (!svc || !svc.client || !svc.identity) return;
    busy = true;
    try {
        const identity = await withTimeout(svc.identity.get(), FETCH_TIMEOUT_MS);
        const account = accountKey(identity);
        let state = loadState();
        const switched = state.account && state.account !== account;
        if (switched) {
            // Another account or profile: nothing from the last one may stay on screen.
            lastRows = {};
            state = emptyState(account);
            saveState(state);
        }
        const fetched = { seen: state.seen, history: null, slots: state.slots, top: state.top, channels: state.channels };
        const rows = await buildRows(svc, identity, fetched);
        if (!enabled()) return; // Switched off while fetching.

        // Playback positions may have been saved while fetching; merge into the newest copy.
        state = loadState();
        if (switched) { state.local = {}; state.server = {}; }
        state.account = account;
        state.seen = fetched.seen;
        state.slots = fetched.slots;
        state.top = fetched.top;
        state.channels = fetched.channels;
        if (fetched.history) state.history = fetched.history;
        const watchNext = configRead('enableHomeScreenWatchNext') ? watchNextOf(state) : [];
        saveState(state);
        send({ v: 1, account, rows, watchNext });
        lastFull = Date.now();
        console.info(LOG, 'published', rows.length, 'rows and', watchNext.length, 'continue-watching cards (' + reason + ')');
        if (onDone) onDone(true, rows.length);
    } catch (e) {
        console.warn(LOG, 'refresh failed:', e && e.message);
        if (onDone) onDone(false);
    } finally {
        busy = false;
        if (pending) {
            const next = pending;
            pending = null;
            setTimeout(() => refresh(next.reason, next.force, next.onDone), 0);
        }
    }
}

const refreshEveryMs = () => Math.max(5, configRead('homeScreenRefreshMinutes') || 30) * 60 * 1000;

/** The "Refresh rows now" button in TizenTube's settings; `showToast(title, subtitle)` reports back. */
export function refreshHomeScreenNow(showToast) {
    if (!enabled()) return;
    showToast('TizenTube', t('settings.options.homeScreen.toasts.refreshing'));
    refresh('button', true, (ok, count) => showToast('TizenTube',
        ok ? t('settings.options.homeScreen.toasts.refreshed', { count }) : t('settings.options.homeScreen.toasts.failed')));
}

let scheduleTimer = null;
function schedule() {
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => {
        if (!document.hidden) refresh('scheduled', true);
        schedule();
    }, refreshEveryMs());
}

function start() {
    if (!native()) return;

    let saveTimer = null;
    onPlayer((p) => {
        player = p;
        player.addEventListener('onStateChange', () => {
            const s = player.getPlayerStateObject ? player.getPlayerStateObject() : {};
            if (s.isPlaying) {
                // Keep a recent position on record in case the app is closed mid-video.
                if (!saveTimer) saveTimer = setInterval(() => recordPlayback(false), 30000);
                return;
            }
            clearInterval(saveTimer); saveTimer = null;
            if (s.isPaused || s.isEnded) {
                if (recordPlayback(!!s.isEnded)) setTimeout(publishWatchNextChecked, 1000);
            }
        });
    });

    let wasWatching = onWatchPage();
    window.addEventListener('hashchange', () => {
        const watching = onWatchPage();
        if (wasWatching && !watching) {
            recordPlayback(false);
            setTimeout(publishWatchNextChecked, 500);
            clearTimeout(afterWatchTimer);
            afterWatchTimer = setTimeout(() => refresh('after watching', Date.now() - lastFull > 5 * 60 * 1000), AFTER_WATCH_MS);
        }
        wasWatching = watching;
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // The page may be frozen next, so publish now rather than on a timer.
            recordPlayback(false);
            publishWatchNext();
        } else {
            refresh('resumed', false);
        }
    });

    configChangeEmitter.addEventListener('configChange', (e) => {
        const key = e.detail && e.detail.key;
        if (!key || !/^(enableHomeScreen|homeScreen)/.test(key)) return;
        if (key === 'enableHomeScreenRows' && !e.detail.value) return clearAll();
        if (key === 'homeScreenRefreshMinutes') return schedule();
        setTimeout(() => refresh('settings changed', true), 1500);
    });

    // Let the app finish starting first; the rows are not urgent.
    setTimeout(() => refresh('startup', true), 20000);
    schedule();
}

if (document.readyState === 'complete') start();
else window.addEventListener('load', start);

export { accountKey, watchNextOf, freshOf };
