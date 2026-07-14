/**
 * liveChat.js — Live Chat overlay for TizenTube
 */

import { configRead } from '../config.js';
import {
    OVERLAY_ID,
    createOverlay,
    removeOverlay,
    setOverlayVisible,
    appendMessage,
} from '../ui/liveChatUI.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const QUEUE_AHEAD_MS = 300;

// WEB client context — this is what desktop YouTube uses.
// It always receives liveChatRenderer in v1/next responses.
const WEB_CLIENT = {
    clientName:    'WEB',
    clientVersion: '2.20240101.00.00',
    hl:            'en',
};

// ─── State ───────────────────────────────────────────────────────────────────

let replayQueue  = [];
let isLive       = false;
let rafId        = null;
let pollTimeout  = null;
let lastVideoId     = null;
let chatVisible     = false;
let fetchGeneration = 0;
let listenersAttached = false;

// ─── API ──────────────────────────────────────────────────────────────────────
// Use the page's own Innertube API key (embedded by YouTube TV in window.ytcfg).
// The official YouTube Data API v3 is not used here because it does not support
// replay chat — only live streams. The Innertube approach works for both.
function getApiKey() {
    try {
        return window.ytcfg?.data_?.INNERTUBE_API_KEY
            || window.yt?.config_?.INNERTUBE_API_KEY
            || null;
    } catch (_) {
        return null;
    }
}

async function apiPost(endpoint, body) {
    const key = getApiKey();
    if (!key) throw new Error('No Innertube API key available');
    const res = await fetch(
        `https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`,
        {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                context: { client: WEB_CLIENT },
                ...body,
            }),
        }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

// ─── Step 1: get continuation token via v1/next ───────────────────────────────

async function startForVideo(videoId, startSecs) {
    startSecs = startSecs || 0;
    // Cancel any in-flight fetch before starting a new one.
    // This prevents duplicate fetches when startForVideo is called twice
    // in quick succession (e.g. init race with pushState hook).
    fetchGeneration++;
    if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
    const gen = fetchGeneration;
    console.log('[LiveChat] fetching v1/next for', videoId, 'startSecs=' + startSecs);
    try {
        const json = await apiPost('next', { videoId });
        const token = findLiveChatContinuation(json);
        if (!token) {
            console.log('[LiveChat] no liveChatRenderer in v1/next — video has no chat');
            return;
        }
        const badge = json?.videoPrimaryInfoRenderer?.viewCount?.videoViewCountRenderer;
        isLive = badge?.isLive === true;
        fetchStartSecs = startSecs;
        console.log('[LiveChat] continuation found, isLive=' + isLive + ' startSecs=' + startSecs);
        fetchChat(token, gen);
    } catch (e) {
        console.warn('[LiveChat] v1/next error:', e.message);
    }
}

// Recursively find the liveChatRenderer continuation token anywhere in the JSON
function findLiveChatContinuation(obj, depth) {
    depth = depth || 0;
    if (depth > 15 || !obj || typeof obj !== 'object') return null;
    if (obj.liveChatRenderer) {
        const conts = obj.liveChatRenderer.continuations;
        if (Array.isArray(conts) && conts.length) {
            return conts[0].reloadContinuationData?.continuation
                || conts[0].timedContinuationData?.continuation
                || conts[0].invalidationContinuationData?.continuation
                || null;
        }
    }
    for (const val of Object.values(obj)) {
        if (Array.isArray(val)) {
            for (const item of val) {
                const found = findLiveChatContinuation(item, depth + 1);
                if (found) return found;
            }
        } else if (val && typeof val === 'object') {
            const found = findLiveChatContinuation(val, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

// ─── Step 2: fetch chat in a loop ─────────────────────────────────────────────

let fetchStartSecs = 0;

async function fetchChat(continuation, gen) {
    if (gen !== fetchGeneration) return;
    const endpoint = isLive ? 'live_chat/get_live_chat' : 'live_chat/get_live_chat_replay';
    try {
        const body = { continuation };
        if (!isLive && fetchStartSecs > 0) {
            body.videoOffsetTimeMsec = String(fetchStartSecs * 1000);
        }
        const json = await apiPost(endpoint, body);
        if (gen !== fetchGeneration) return;
        const nextToken = processChat(json);

        if (!nextToken) {
            console.log('[LiveChat] no next token — chat ended');
            return;
        }

        if (isLive) {
            const cont = json?.continuationContents?.liveChatContinuation?.continuations?.[0];
            const intervalMs = cont?.timedContinuationData?.timeoutMs
                || cont?.invalidationContinuationData?.timeoutMs
                || 5000;
            pollTimeout = setTimeout(() => fetchChat(nextToken, gen), intervalMs);
        } else {
            // Fetch all replay batches quickly, small yield to avoid blocking UI
            pollTimeout = setTimeout(() => fetchChat(nextToken, gen), 50);
        }
    } catch (e) {
        console.warn('[LiveChat] fetchChat error:', e.message, '— retrying in 5s');
        pollTimeout = setTimeout(() => fetchChat(continuation, gen), 5000);
    }
}

// ─── Chat response parsing ────────────────────────────────────────────────────

function processChat(json) {
    const continuation = json?.continuationContents?.liveChatContinuation;
    if (!continuation) return null;

    const actions = continuation.actions || [];
    let count = 0;

    for (const action of actions) {
        const item = action?.addChatItemAction?.item
            || action?.replayChatItemAction?.actions?.[0]?.addChatItemAction?.item;
        if (!item) continue;

        const renderer = item.liveChatTextMessageRenderer
            || item.liveChatPaidMessageRenderer;
        if (!renderer) continue;

        const authorName  = extractText(renderer.authorName);
        const messageText = extractRuns(renderer.message?.runs);
        if (!authorName || !messageText) continue;

        const badgeColor = extractBadgeColor(renderer.authorBadges);

        if (isLive) {
            appendMessage(authorName, messageText, badgeColor);
        } else {
            const offsetMs = parseInt(
                action?.replayChatItemAction?.videoOffsetTimeMsec || '0', 10
            );
            replayQueue.push({ offsetMs, authorName, messageText, badgeColor });
        }
        count++;
    }

    if (count > 0) {
        if (!isLive) {
            replayQueue.sort((a, b) => a.offsetMs - b.offsetMs);
            console.log('[LiveChat] replay queue:', replayQueue.length, 'messages, firstOffsetMs=' + (replayQueue[0]?.offsetMs ?? '?'));
        } else {
            console.log('[LiveChat] live: displayed', count, 'messages');
        }
    }

    const conts = continuation.continuations || [];
    return conts[0]?.timedContinuationData?.continuation
        || conts[0]?.invalidationContinuationData?.continuation
        || conts[0]?.liveChatReplayContinuationData?.continuation
        || conts[0]?.reloadContinuationData?.continuation
        || null;
}

function extractText(obj) {
    if (!obj) return '';
    return obj.simpleText || extractRuns(obj.runs) || '';
}

function extractRuns(runs) {
    if (!runs) return '';
    return runs.map(r => {
        if (r.text) return r.text;
        if (!r.emoji) return '';
        if (!r.emoji.isCustomEmoji) return r.emoji.emojiId || r.emoji.shortcuts?.[0] || '';
        // Custom channel emotes: emojiId is an internal ID string, use shortcut text instead
        return r.emoji.shortcuts?.[0] || '';
    }).join('');
}

function extractBadgeColor(badges) {
    if (!badges || !badges.length) return '';
    const type = badges[0]?.liveChatAuthorBadgeRenderer?.icon?.iconType || '';
    if (type === 'MODERATOR')      return 'ffd600';
    if (type === 'OWNER')          return 'ff4444';
    if (type.startsWith('MEMBER')) return '22bb66';
    return '';
}

// ─── Replay sync loop ─────────────────────────────────────────────────────────

function startReplayLoop() {
    console.log('[LiveChat] replay loop started');
    const intervalId = setInterval(() => {
        const video = document.querySelector('video');
        if (!video) return;
        const nowMs = video.currentTime * 1000;
        if (Math.floor(nowMs / 10000) !== Math.floor(Math.max(0, nowMs - 250) / 10000)) {            console.log('[LiveChat] nowMs=' + nowMs.toFixed(0)
                + ' queueLen=' + replayQueue.length
                + ' firstOffsetMs=' + (replayQueue[0]?.offsetMs ?? 'empty'));
        }
        while (replayQueue.length && replayQueue[0].offsetMs <= nowMs + QUEUE_AHEAD_MS) {
            const { authorName, messageText, badgeColor } = replayQueue.shift();
            appendMessage(authorName, messageText, badgeColor);
        }
    }, 250);
    // Store so we can cancel on navigation
    rafId = intervalId;
}

// ─── Video seek handling ──────────────────────────────────────────────────────

function attachVideoListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    const video = document.querySelector('video');
    if (!video) { listenersAttached = false; setTimeout(attachVideoListeners, 500); return; }

    // Handle seek — trim forward or re-fetch on backward seek
    let lastKnownMs = 0;
    const onSeek = () => {
        const nowMs = video.currentTime * 1000;
        if (nowMs < lastKnownMs - 5000) {
            console.log('[LiveChat] backward seek to ' + nowMs.toFixed(0) + ' — re-fetching chat');
            stopAll();
            replayQueue = [];
            const seekSecs = Math.max(0, Math.floor(nowMs / 1000) - 5);
            startForVideo(lastVideoId, seekSecs);
        } else {
            replayQueue = replayQueue.filter(m => m.offsetMs > nowMs);
            console.log('[LiveChat] forward seek — queue trimmed to', replayQueue.length);
        }
        lastKnownMs = nowMs;
    };

    const onPlay = () => {
        console.log('[LiveChat] video playing, currentTime=' + video.currentTime);
        if (!rafId) startReplayLoop();
    };

    video.addEventListener('seeked', onSeek);
    video.addEventListener('play', onPlay);
    video.addEventListener('playing', onPlay);

    if (!video.paused) onPlay();
    console.log('[LiveChat] video listeners attached');
}

// ─── Stop everything ─────────────────────────────────────────────────────────

function stopAll() {
    fetchGeneration++;
    if (rafId)       { clearInterval(rafId); rafId = null; }
    if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
}

// ─── SPA navigation detection ─────────────────────────────────────────────────
// YouTube TV updates the URL via hashchange (not pushState)

function getCurrentVideoId() {
    // Strip any extra params like ?t=30 that may be appended to the video ID
    const m = location.href.match(/[?&]v=([^&?#]+)/);
    return m ? m[1] : null;
}

function onVideoChange(videoId) {
    if (!videoId || videoId === lastVideoId) return;
    lastVideoId = videoId;
    console.log('[LiveChat] video changed to', videoId);
    stopAll();
    replayQueue = [];
    listenersAttached = false;
    createOverlay(chatVisible);
    startForVideo(videoId);
    attachVideoListeners();
}

function observeNavigation() {
    // YouTube TV uses hashchange for navigation
    window.addEventListener('hashchange', () => {
        onVideoChange(getCurrentVideoId());
    });
    // Also hook pushState as fallback
    const orig = history.pushState.bind(history);
    history.pushState = function(...args) {
        orig(...args);
        onVideoChange(getCurrentVideoId());
    };
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// ─── Public API ──────────────────────────────────────────────────────────────

export function setLiveChatVisible(visible) {
    chatVisible = visible;
    if (visible) {
        createOverlay(true);
        if (!pollTimeout && !rafId) {
            replayQueue = [];
            listenersAttached = false;
            const vid = getCurrentVideoId();
            if (vid) {
                lastVideoId = vid;
                const video = document.querySelector('video');
                const seekSecs = video ? Math.max(0, Math.floor(video.currentTime) - 5) : 0;
                startForVideo(vid, seekSecs);
                attachVideoListeners();
            }
        }
    }
    setOverlayVisible(visible);
    if (!visible) stopAll();
}

export function isLiveChatVisible() {
    return chatVisible;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

if (!configRead('liveChatEnabled')) {
    console.log('[LiveChat] disabled in config');
} else {
    chatVisible = true; // auto-start means panel should be visible
    createOverlay(true);
    observeNavigation();
    attachVideoListeners();
    const vid = getCurrentVideoId();
    lastVideoId = vid;
    if (vid) startForVideo(vid);
    console.log('[LiveChat] initialised, current video:', vid);
}
