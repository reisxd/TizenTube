# TizenTube

TizenTube is a TizenBrew module that enhances your favourite streaming websites viewing experience by removing ads and adding support for Sponsorblock.

Looking for an app for Android TVs? Check out [TizenTube Cobalt](https://github.com/reisxd/TizenTubeCobalt). It offers everything TizenTube has for Android TVs. [Download the latest release here](https://github.com/reisxd/TizenTubeCobalt/releases/latest).

[Discord Server Invite](https://discord.gg/m2P7v8Y2qR)

[Telegram Channel](https://t.me/tizentubeofficial)

# How to install

1. Install TizenBrew from [here](https://github.com/reisxd/TizenBrew) and follow the instructions.

2. TizenTube is installed to TizenBrew by default. It should be in the home screen. If not, add `@foxreis/tizentube` as a NPM module in TizenBrew module manager.

# Features

- Ad Blocker
- [SponsorBlock](https://sponsor.ajay.app/) Support
- Picture-in-Picture Mode
- [DeArrow](https://dearrow.ajay.app/) Support
- Customizable Themes (Custom Coloring)
- More to come, if you [request](https://github.com/reisxd/TizenTube/issues/new) it!

# Tampermonkey local debugging helpers (Windows + Chrome)

Use this when you want to test TizenTube locally in Chrome instead of on-device.

Tampermonkey runs the userscripts, while a User-Agent switcher extension makes Chrome present itself as a TV browser so `https://www.youtube.com/tv` stays on the TV UI.

## Scripts in this repository

Tampermonkey scripts are stored in:

- `scripts/tampermonkey/tizentube-loader.user.js` (loads `dist/userScript.js` via `@require`)
- `scripts/tampermonkey/tizentube-log-button.user.js` (adds floating **TT Logs** button that calls `window.downloadTizenTubeLogs()`)

## Full setup steps

1. Install **Tampermonkey** in Chrome.
2. Open `chrome://extensions/`:
   - Enable **Developer mode** (top-right).
   - Open Tampermonkey details and enable **Allow in Incognito**.
   - If you use a User-Agent extension, also enable **Allow in Incognito** for it.
3. Install a User-Agent switching extension (for TV UA testing).
4. Set a TV-like User-Agent for YouTube. Example that usually works (can be in Incognito Mode):

   `Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/3.0 TV Safari/537.36`


   Real TV User-Agent examples:

   - Tizen 5.0 TV:
     `Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36`
   - Tizen 6.5 TV:
     `Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/6.5 TV Safari/537.36 UWE/0.2.27108`

5. In Tampermonkey, create/import `scripts/tampermonkey/tizentube-loader.user.js` (configured for `youtube.com/tv*` only).
6. In Tampermonkey, create/import `scripts/tampermonkey/tizentube-log-button.user.js` (configured for `youtube.com/tv*` only).
7. In Tampermonkey script settings, set **Sandbox mode = ALL** for these scripts.
8. Open `https://www.youtube.com/tv` and sign in if needed.
9. Click **TT Logs** (bottom-right corner of the page, floating above the YouTube TV UI) to download logs without typing console commands.


### Keyboard shortcuts for Windows testing (no TV remote)

When testing in Chrome on desktop, TizenTube maps TV color-button actions to normal keys:

- **GREEN** (open TizenTube settings): `G`, `F2`, or `2`
- **RED** (open theme settings): `R`, `F1`, or `1`
- **YELLOW** (toggle debug console): `Y`, `F3`, or `3`
- **BLUE**: `B`, `F4`, or `4`

### Where should I see the button?

After both userscripts are enabled and `/tv` has loaded, the **TT Logs** button appears in the **bottom-right corner** as a small black/green floating button.

If you do not see it:
- confirm `tizentube-log-button.user.js` is enabled in Tampermonkey,
- refresh the page once,
- and verify Tampermonkey script sandbox is set to **ALL**.

## Notes

- These helper scripts are intentionally limited to `/tv` URLs so they do not affect normal desktop YouTube pages.
- In Tampermonkey, you can force-refresh `@require` files via **TizenTube Loader → Externals → Requires → Update**.
- If Tampermonkey seems stale in Incognito, open script dashboard and use **Utilities → Check for userscript updates**, then hard-refresh YouTube TV.
- Tampermonkey only refreshes `@require` when it checks script updates; bumping loader `@version` and running update check forces newest bundle.
- If `/tv` redirects back to desktop YouTube, re-check User-Agent override and extension scope.
- Keep both scripts enabled: loader + log-button.
- The log button is external (Tampermonkey UI helper), not an in-app visual-console button.