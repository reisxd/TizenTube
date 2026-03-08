# TizenTube AI Coding Assistant Guide

## Project Overview
TizenTube is a TizenBrew userScript enhancement that modifies YouTube TV on Samsung Tizen TVs. It consists of two main components:
- **mods/**: Browser-based userScript (injected into YouTube TV) that adds ad blocking, SponsorBlock support, UI enhancements, and playback controls
- **service/**: Backend Express server that handles DIAL protocol communication for app launching and state management

## Architecture Patterns

### Configuration System (mods/config.js)
Uses a centralized localStorage-backed config manager:
- `configRead(key)` - reads configuration with fallback to defaults
- `configWrite(key, value)` - writes to localStorage and emits `configChange` events
- All feature toggles consume this API (adblock, sponsorblock, themes, UI flags, etc.)
- Add new settings to `defaultConfig` object; features automatically support them

### JSON Interception Pattern (mods/features/)
Many features patch YouTube's JSON parsing to modify response data:
```javascript
const origParse = JSON.parse;
JSON.parse = function() {
  const r = origParse.apply(this, arguments);
  if (r.adPlacements && configRead('enableAdBlock')) {
    r.adPlacements = [];  // Strip ads from response
  }
  return r;
};
```
Used by: adblock.js, videoQueuing.js. This is more reliable than DOM manipulation since it works at data layer.

### Code Analysis (mods/utils/ASTParser.js)
AST parsing tool (`extractAssignedFunctions()`) extracts YouTube's obfuscated functions:
- Uses esprima/estraverse to parse multiple syntax variations
- Handles wrapped/module code gracefully
- Used by resolveCommand.js to find YouTube's internal methods dynamically

### Spatial Navigation Override (mods/ui/ui.js, spatial-navigation-polyfill.js)
Disables YouTube's spatial nav, implements custom keyboard handling:
- Arrow keys mapped to custom `navigate()` function
- OK/Space buttons trigger custom actions
- UI container must have focus for events to work
- Used for menus, settings, custom controls

## Build System

### Rollup Configuration (mods/rollup.config.js, service/rollup.config.js)
- **Target**: Chrome 47 (Tizen TV standard) via Babel preset-env
- **Output format**: IIFE (Immediately Invoked Function Expression) - creates single `dist/userScript.js` and `dist/service.js`
- **Plugins**: 
  - `rollup-plugin-string`: Inlines CSS files as strings (see ui.css injection in ui.js)
  - `@rollup/plugin-babel`: Transpiles modern JS to ES5
  - `@rollup/plugin-terser`: Minifies for TV memory constraints

Build command: `npm run build` in mods/ and service/ folders

### Entry Points
- **mods/userScript.js**: Imports all features and UI modules in order; last import wins on conflicts
- **service/service.js**: Express app with DIAL server delegate

## Feature Integration Points

### Features Import Order (mods/userScript.js)
Carefully ordered:
1. Polyfills (whatwg-fetch, core-js, @formatjs intl)
2. User agent spoofing (must run first to intercept navigator)
3. Functional features (adblock, sponsorblock, etc.)
4. UI modules (ui.js patches DOM, then settings.js, theme.js customize)
5. Custom extensions (customUI.js, customGuideAction.js)

Late-imported features can override earlier DOM/config state.

### Service-to-Mod Communication
Service.js runs DIAL protocol; userScript communicates back via:
- YouTube TV's existing socket/request mechanisms
- additionalData in DIAL response (parsed in userScript.js line ~80 in service.js)
- localStorage (simple cross-component state)

## Key Conventions

### Config Keys
Use clear, boolean-prefixed naming: `enableAdBlock`, `enableSponsorBlock`, `enablePatchingVideoPlayer`, etc. Numeric configs use full names: `dimmingTimeout`, `speedSettingsIncrement`

### CSS Injection (mods/ui/ui.css)
- Single CSS file imported as string in ui.js
- Appended to existing `<style nonce>` or new `<style>` tag
- Use namespaced classes: `.ytaf-ui-container`, `.ytaf-button`

### Feature Toggles
Every UI-affecting feature has a config toggle. Check it early:
```javascript
if (!configRead('enableFeatureName')) return;
```

### Error Handling
Wrapped in try-catch with `console.warn/error`:
```javascript
try {
  window.tectonicConfig.featureSwitches.isLimitedMemory = false;
} catch (e) { }
```
Tizen's APIs are unpredictable; silent failures preferred to avoid crashes.

## Testing & Deployment
- No automated tests defined; manual testing on Tizen devices required
- Bundle output: `dist/userScript.js` and `dist/service.js`
- Installed via TizenBrew module manager using package.json's `name` field: `@JensorX/tizentube`
- Website URL in package.json points to YouTube TV with DIAL service on port 8085

## Common Tasks

**Adding a new feature**: 
1. Create file in mods/features/ or mods/ui/
2. Import config keys needed via `configRead()`
3. Add toggle to mods/config.js defaultConfig
4. Import file in mods/userScript.js in appropriate order
5. Run `npm run build` in mods/

**Modifying YouTube data**:
Use JSON.parse interception pattern in adblock.js as template; deep clone and mutate response objects before returning

**Keyboard/navigation changes**:
Edit mods/ui/ui.js keydown handler and update spatial-navigation-polyfill.js if needed
