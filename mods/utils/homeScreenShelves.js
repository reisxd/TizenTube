// Sorts YouTube's Home shelves into the home screen's fixed rows. Pure functions, no globals.
//
// Fixed rows: Recommended, Recently uploaded and Top channels keep their own rows. Every other
// shelf goes into one of a few "variable" rows, which keep a generic name until the same shelf
// has stayed in the row for a while (launchers such as Projectivy only re-read names on restart).

const TOP_KEEP_MS = 12 * 60 * 60 * 1000;
const TOP_MAX = 40;
export const STABLE_REFRESHES = 3;

const RECOMMENDED = /^recommended( for you)?$/i;
const RECENTLY_UPLOADED = /^recently uploaded$/i;

export const keyOf = shelf => (shelf.title ? shelf.title.toLowerCase() : 'untitled:' + (shelf.cards[0] && shelf.cards[0].id));

/**
 * Splits shelves (in page order) into the fixed rows and the rest.
 * Top channels is the shelf made of channel cards, whatever its title or language. Recommended and
 * Recently uploaded go by their English titles; if no shelf is titled Recommended, the first video
 * shelf stands in for it.
 */
export function classifyShelves(shelves) {
    const out = { recommended: null, recentlyUploaded: null, topChannels: null, variable: [] };
    for (const shelf of shelves) {
        const channels = shelf.cards.filter(c => c.type === 'channel').length;
        if (!out.topChannels && channels > shelf.cards.length / 2) out.topChannels = shelf;
        else if (!out.recommended && RECOMMENDED.test(shelf.title)) out.recommended = shelf;
        else if (!out.recentlyUploaded && RECENTLY_UPLOADED.test(shelf.title)) out.recentlyUploaded = shelf;
        else out.variable.push(shelf);
    }
    if (!out.recommended && out.variable.length && !RECENTLY_UPLOADED.test(out.variable[0].title) && shelves[0] === out.variable[0]) {
        out.recommended = out.variable.shift();
    }
    return out;
}

/** True once a page set has everything the rows need, so no more Home pages are fetched. */
export function enoughShelves(sorted, variableCount) {
    return !!(sorted.recommended && sorted.recentlyUploaded && sorted.topChannels) && sorted.variable.length >= variableCount;
}

/**
 * Places variable shelves into `count` rows. A shelf that is still on Home keeps its row; new
 * shelves take rows that were freed. Rows with no shelf this time keep their last cards (cards: null).
 * Returns the new slot list: [{ key, title, streak, cards | null }].
 */
export function assignSlots(previous, shelves, count) {
    const prev = (previous || []).slice(0, count);
    while (prev.length < count) prev.push(null);
    const byKey = {};
    for (const s of shelves) if (!byKey[keyOf(s)]) byKey[keyOf(s)] = s;
    const used = {};
    const slots = prev.map((p) => {
        if (p && p.key && byKey[p.key] && !used[p.key]) {
            used[p.key] = true;
            return { key: p.key, title: byKey[p.key].title, streak: (p.streak || 0) + 1, cards: byKey[p.key].cards };
        }
        return null;
    });
    const fresh = shelves.filter(s => !used[keyOf(s)]);
    return slots.map((slot, i) => {
        if (slot) return slot;
        const next = fresh.shift();
        if (next) {
            used[keyOf(next)] = true;
            return { key: keyOf(next), title: next.title, streak: 1, cards: next.cards };
        }
        // Nothing new for this row: it keeps what it showed, under the same name.
        const p = prev[i];
        return p ? { key: p.key, title: p.title, streak: p.streak, cards: null } : { key: '', title: '', streak: 0, cards: null };
    });
}

/** The name a variable row shows: the shelf's own once it has been stable, else the generic one. */
export function slotTitle(slot, genericName) {
    return slot && slot.title && slot.streak >= STABLE_REFRESHES ? slot.title : genericName;
}

/**
 * Keeps Top channels across refreshes. When the shelf is found, its channels lead in YouTube's
 * order and are marked seen; channels it no longer has stay until unseen for 12 hours. When the
 * shelf isn't found, nothing is dropped. Returns { store, cards }.
 */
export function mergeTopChannels(store, cards, now) {
    const entries = (store && store.entries) ? store.entries.slice() : [];
    if (!cards) return { store: { entries }, cards: entries.map(e => e.card) };
    const ids = {};
    const lead = cards.filter(c => c.type === 'channel').map((card) => {
        ids[card.id] = true;
        return { card, seen: now };
    });
    const kept = entries.filter(e => !ids[e.card.id] && now - e.seen <= TOP_KEEP_MS);
    const merged = lead.concat(kept).slice(0, TOP_MAX);
    return { store: { entries: merged }, cards: merged.map(e => e.card) };
}

/**
 * The channels you watch most, from History cards (newest first): each video counts, newer ones a
 * little more. Channels in the Subscriptions feed add a little, so subscriptions fill the row out.
 * Returns [{ id, name }] best first.
 */
export function rankChannels(historyCards, limit, subscriptionCards) {
    const score = {};
    const name = {};
    (historyCards || []).forEach((c, i) => {
        if (!c.channelId) return;
        score[c.channelId] = (score[c.channelId] || 0) + Math.pow(0.98, i);
        if (!name[c.channelId] && c.channelName) name[c.channelId] = c.channelName;
    });
    // Subscriptions count for less than watching: a quarter per recent upload, at most one video's worth.
    const subs = {};
    for (const c of subscriptionCards || []) {
        if (!c.channelId) continue;
        subs[c.channelId] = Math.min(1, (subs[c.channelId] || 0) + 0.25);
        if (!name[c.channelId] && c.channelName) name[c.channelId] = c.channelName;
    }
    for (const id of Object.keys(subs)) score[id] = (score[id] || 0) + subs[id];
    return Object.keys(score).sort((a, b) => score[b] - score[a]).slice(0, limit)
        .map(id => ({ id, name: name[id] || '' }));
}
