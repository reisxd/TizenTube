// Turns YouTube TV browse responses into the plain cards published to the Android home screen.
// Pure functions only (no DOM, no globals) so they can be tested outside the app.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const MAX_TEXT = 200;
const MAX_DEPTH = 40;

export function text(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (Array.isArray(t.runs)) return t.runs.map(r => (r && r.text) || '').join('');
    return t.simpleText || t.content || '';
}

function clip(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + '\u2026' : s;
}

// "12:34" or "1:02:03" to seconds; 0 if it isn't a clock time.
export function clockToSeconds(s) {
    if (!s || !/^\d{1,3}(:\d{2}){1,2}$/.test(s.trim())) return 0;
    return s.trim().split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

// English relative ages ("3 hours ago", "Streamed 2 days ago") to seconds; -1 when unknown.
const UNIT = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
export function ageSeconds(s) {
    const m = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(s || '');
    return m ? Number(m[1]) * UNIT[m[2].toLowerCase()] : -1;
}

// The first value of property `key` found under `obj`, searching depth-first up to 6 levels.
function findKey(obj, key, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 6) return null;
    if (obj[key]) return obj[key];
    for (const v of Object.values(obj)) {
        const hit = findKey(v, key, (depth || 0) + 1);
        if (hit) return hit;
    }
    return null;
}

// The widest image, if it is on YouTube's image hosts. `wide` is true when it is roughly 16:9.
function bestThumb(list) {
    const none = { url: '', wide: false };
    if (!Array.isArray(list) || list.length === 0) return none;
    const best = list.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    let url = (best && best.url) || '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    if (!/^https:\/\/[a-z0-9.-]+\.(ytimg\.com|ggpht\.com|googleusercontent\.com)\//i.test(url)) return none;
    const ratio = best.width && best.height ? best.width / best.height : 0;
    return { url, wide: ratio > 1.6 && ratio < 1.9 };
}

// Line items that are only separators; cards get their own.
const SEPARATOR = /^[\s\u2022\u00b7|-]*$/;

function idsFrom(command) {
    const watch = findKey(command, 'watchEndpoint') || findKey(command, 'reelWatchEndpoint');
    const playlist = findKey(command, 'watchPlaylistEndpoint');
    const browse = findKey(command, 'browseEndpoint');
    return {
        videoId: watch && watch.videoId,
        playlistId: (watch && watch.playlistId) || (playlist && playlist.playlistId),
        startSeconds: (watch && watch.startTimeSeconds) || 0,
        browseId: browse && browse.browseId,
        reel: !!findKey(command, 'reelWatchEndpoint'),
    };
}

// Builds a card from the parts both renderer types share. Returns null for anything that can't be opened.
// The channel a video belongs to: the first channel link in its metadata (the channel-name run).
function channelOf(meta) {
    let found = null;
    (function walk(node, depth) {
        if (found || !node || typeof node !== 'object' || depth > 16) return;
        const b = node.browseEndpoint;
        if (b && CHANNEL_ID.test(b.browseId || '')) {
            found = { id: b.browseId, name: '' };
            return;
        }
        if (Array.isArray(node.runs)) {
            for (const run of node.runs) {
                const id = run && run.navigationEndpoint && run.navigationEndpoint.browseEndpoint && run.navigationEndpoint.browseEndpoint.browseId;
                if (id && CHANNEL_ID.test(id)) { found = { id, name: clip(run.text) }; return; }
            }
        }
        for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, depth + 1);
    })(meta, 0);
    return found;
}

function card(p) {
    const c = { title: clip(p.title), subtitle: clip(p.lines.filter(Boolean).join(' \u2022 ')), thumb: p.thumb.url };
    if (!c.title) return null;
    if (p.upcoming) return null;
    if (p.videoId && VIDEO_ID.test(p.videoId)) {
        c.type = 'video';
        c.id = p.videoId;
        if (p.playlistId && PLAYLIST_ID.test(p.playlistId)) c.playlistId = p.playlistId;
        // Cards are 16:9; YouTube's 4:3 images (hqdefault) are letterboxed, so use its 16:9 one instead.
        if (!p.thumb.wide) c.thumb = 'https://i.ytimg.com/vi/' + p.videoId + '/mqdefault.jpg';
    } else if (p.playlistId && PLAYLIST_ID.test(p.playlistId)) {
        c.type = 'playlist';
        c.id = p.playlistId;
    } else if (p.browseId && /^VL/.test(p.browseId) && PLAYLIST_ID.test(p.browseId.slice(2))) {
        c.type = 'playlist';
        c.id = p.browseId.slice(2);
    } else if (p.browseId && CHANNEL_ID.test(p.browseId)) {
        c.type = 'channel';
        c.id = p.browseId;
    } else {
        return null;
    }
    if (!c.thumb) return null;
    if (p.duration) c.duration = p.duration;
    if (p.live) c.live = true;
    if (p.shorts) c.shorts = true;
    if (p.progress > 0) c.progress = Math.min(100, Math.round(p.progress));
    const age = p.lines.map(ageSeconds).find(a => a >= 0);
    if (age !== undefined) c.age = age;
    if (c.type === 'video' && p.channel) {
        c.channelId = p.channel.id;
        c.channelName = p.channel.name;
    }
    return c;
}

export function parseTile(r) {
    if (!r) return null;
    const meta = (r.metadata && r.metadata.tileMetadataRenderer) || {};
    const header = (r.header && r.header.tileHeaderRenderer) || {};
    const lines = (meta.lines || []).map(l =>
        ((l.lineRenderer && l.lineRenderer.items) || [])
            .map(i => text(i.lineItemRenderer && i.lineItemRenderer.text))
            .filter(t => !SEPARATOR.test(t)).join(' \u2022 '));
    let duration = 0, live = false, upcoming = false, shorts = false, progress = 0;
    for (const o of header.thumbnailOverlays || []) {
        const ts = o.thumbnailOverlayTimeStatusRenderer;
        if (ts) {
            duration = duration || clockToSeconds(text(ts.text));
            if (ts.style === 'LIVE') live = true;
            if (ts.style === 'UPCOMING') upcoming = true;
            if (ts.style === 'SHORTS') shorts = true;
        }
        const rp = o.thumbnailOverlayResumePlaybackRenderer;
        if (rp) progress = rp.percentDurationWatched || 0;
    }
    const ids = idsFrom(r.onSelectCommand);
    if (r.style === 'TILE_STYLE_YTLR_SHORTS' || ids.reel) shorts = true;
    return card({
        title: text(meta.title), lines, thumb: bestThumb(header.thumbnail && header.thumbnail.thumbnails),
        duration, live, upcoming, shorts, progress, channel: channelOf(meta.lines), ...ids,
    });
}

export function parseLockup(r) {
    if (!r) return null;
    const meta = (r.metadata && r.metadata.lockupMetadataViewModel) || {};
    const rows = (meta.metadata && meta.metadata.contentMetadataViewModel && meta.metadata.contentMetadataViewModel.metadataRows) || [];
    const lines = rows.map(row => (row.metadataParts || []).map(p => text(p.text)).filter(t => !SEPARATOR.test(t)).join(' \u2022 '));
    const image = r.contentImage || {};
    const thumbView = image.thumbnailViewModel ||
        (image.collectionThumbnailViewModel && image.collectionThumbnailViewModel.primaryThumbnail &&
            image.collectionThumbnailViewModel.primaryThumbnail.thumbnailViewModel) || {};
    let duration = 0, live = false, progress = 0;
    for (const o of thumbView.overlays || []) {
        const bar = o.thumbnailBottomOverlayViewModel && o.thumbnailBottomOverlayViewModel.progressBar &&
            o.thumbnailBottomOverlayViewModel.progressBar.thumbnailOverlayProgressBarViewModel;
        if (bar) progress = bar.startPercent || 0;
        const badges = (o.thumbnailOverlayBadgeViewModel && o.thumbnailOverlayBadgeViewModel.thumbnailBadges) ||
            (o.thumbnailBottomOverlayViewModel && o.thumbnailBottomOverlayViewModel.badges) || [];
        for (const b of badges) {
            const vm = b.thumbnailBadgeViewModel;
            if (!vm) continue;
            if (vm.badgeStyle === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE') live = true;
            duration = duration || clockToSeconds(vm.text);
        }
    }
    const command = r.rendererContext && r.rendererContext.commandContext && r.rendererContext.commandContext.onTap;
    const ids = idsFrom(command);
    return card({
        title: text(meta.title), lines, thumb: bestThumb(thumbView.image && thumbView.image.sources),
        duration, live, upcoming: false, shorts: ids.reel, progress, channel: channelOf(meta.metadata), ...ids,
    });
}

// Walks any browse or continuation response and returns its shelves in page order:
// [{ title, cards }]. Tiles outside a shelf (grids, playlists) land in one untitled shelf.
export function shelvesOf(response) {
    const shelves = [];
    const loose = { title: '', cards: [] };

    function walk(node, shelf, depth) {
        if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
        if (Array.isArray(node)) {
            for (const n of node) walk(n, shelf, depth + 1);
            return;
        }
        if (node.tileRenderer || node.lockupViewModel) {
            const c = node.tileRenderer ? parseTile(node.tileRenderer) : parseLockup(node.lockupViewModel);
            if (c) (shelf || loose).cards.push(c);
            return;
        }
        if (node.shelfRenderer) {
            const s = node.shelfRenderer;
            const h = s.headerRenderer && s.headerRenderer.shelfHeaderRenderer;
            const title = text(s.title) || (h && (text(h.title) ||
                (h.avatarLockup && h.avatarLockup.avatarLockupRenderer && text(h.avatarLockup.avatarLockupRenderer.title)))) || '';
            // `next`: the token for more of this shelf's cards (TV shelves arrive five at a time).
            const next = { title: clip(title), cards: [], next: continuationOf(s.content) };
            shelves.push(next);
            walk(s.content, next, depth + 1);
            return;
        }
        for (const key of Object.keys(node)) {
            // Skip tracking blobs and the frame around the content; they never hold cards.
            if (key === 'trackingParams' || key === 'responseContext' || key === 'frameworkUpdates') continue;
            walk(node[key], shelf, depth + 1);
        }
    }

    walk(response, null, 0);
    if (loose.cards.length) shelves.push(loose);
    return shelves.filter(s => s.cards.length > 0);
}

// The token for the next page of a feed, if there is one. The shallowest token wins: deeper ones
// belong to single shelves (more cards sideways), not to the feed itself.
export function continuationOf(response) {
    let best = null, bestDepth = Infinity;
    (function walk(node, depth) {
        if (!node || typeof node !== 'object' || depth > MAX_DEPTH || depth >= bestDepth) return;
        const token = (node.nextContinuationData && node.nextContinuationData.continuation) ||
            (node.continuationCommand && node.continuationCommand.token);
        if (token) { best = token; bestDepth = depth; return; }
        for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, depth + 1);
    })(response, 0);
    return best;
}

// Removes repeats (same type and id) and Shorts when asked, keeping the first of each.
export function tidy(cards, opts) {
    const seen = {};
    const out = [];
    for (const c of cards) {
        const k = c.type + ':' + c.id;
        if (seen[k]) continue;
        if (opts && opts.noShorts && c.shorts) continue;
        seen[k] = true;
        out.push(c);
    }
    return out;
}

// A bigger copy of a YouTube avatar (their URLs carry the size, e.g. "=s72-c-k-...").
export function largerAvatar(url, size) {
    return url ? url.replace(/=s\d+(-|$)/, '=s' + (size || 240) + '$1') : url;
}

// Name, line and avatar from a channel page's header, as a channel card. Null if there's no header.
export function channelCardOf(response, channelId) {
    const header = (function find(node, depth) {
        if (!node || typeof node !== 'object' || depth > 12) return null;
        if (node.channelHeaderRenderer) return node.channelHeaderRenderer;
        for (const v of Array.isArray(node) ? node : Object.values(node)) {
            const hit = find(v, depth + 1);
            if (hit) return hit;
        }
        return null;
    })(response && response.contents, 0);
    if (!header || !CHANNEL_ID.test(channelId || '')) return null;
    const avatar = bestThumb(header.avatar && header.avatar.thumbnails);
    const title = clip(text(header.title));
    if (!title || !avatar.url) return null;
    return { type: 'channel', id: channelId, title, subtitle: clip(text(header.subtitle)), thumb: largerAvatar(avatar.url) };
}
