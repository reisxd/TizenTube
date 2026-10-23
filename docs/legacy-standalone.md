# Standalone startup on older Tizen TVs

The Old build runs a Node.js service and uses the TV's own SDB/CDP connection to
start the web application. These runtimes differ from the browser and Node.js
versions used to build the package.

## Verified device

| Component | Observed version |
| --- | --- |
| TV | Samsung UE55RU8000UXRU (2019) |
| Firmware | T-MSMDEUC-1500.9 |
| Tizen | 5.0 |
| Web service Node.js | v4.4.3, reported by the service itself |
| Browser generation | Chromium M63, per Samsung's engine specifications |

A local Old build based on v2.1.1, with these startup/userscript fixes, was
installed through Apps2Samsung 3.0.0-beta with Samsung Partner signing. After
restoring Developer Mode Host PC IP to `127.0.0.1` and rebooting, the owner
confirmed full standalone operation, including video playback and ad blocking.
No PC connection or manual script injection was required during normal use.

This is one device report, not a compatibility claim for every Tizen version.
Cobalt playback on newer TVs was not tested on hardware.

## What the investigation established

- A locally rebuilt, untranspiled service failed before opening its HTTP port:
  `SyntaxError: Block-scoped declarations ... not yet supported outside strict mode`.
  The service diagnostic reported Node.js v4.4.3. The same failure reproduced on
  the official Node.js 4.4.3 Linux binary. The official v2.1.1 Old bundle already
  passed that syntax check; this was not evidence that the official release had
  the same build defect. Transforming the complete final bundle keeps dependencies
  and the bundler wrapper within the service runtime's supported syntax.
- Chromium M63 has no `Page.setBypassCSP` command. Making startup wait for that
  command exposed a method-not-found error. The Old path now registers the script
  with `Page.addScriptToEvaluateOnLoad` before navigation without that command.
- The userscript can run before `document.head`/`document.body` exist. A
  document-start bootstrap waits for both before initializing its UI modules.
- Missing or malformed YouTube recurring-actions storage could throw during
  initialization before the ad blocker was installed. The optional account-menu
  feature now retries independently, allowing the remaining modules to initialize.
- Empty SDB launch responses and overlapping callbacks could leave startup stuck.
  Launch retries, command deadlines, cancellation and explicit error states make
  failures recoverable. The initiating app exits only after the service accepts
  its request; a debugger-launched app waits for navigation instead of exiting.

The service's ES5 lifecycle entry reports its runtime and synchronous bundle-load
errors through MessagePort, even when HTTP never starts. A `loaded` status does
not diagnose asynchronous server failures.

For the Old/CDP path, the userscript is built from this checkout and included in
the standalone package. This removes its startup CDN dependency; userscript updates
require a new standalone build/install. Native Cobalt still loads its userscript
from the CDN. The TizenBrew module distribution is unchanged.

## Reproduce the local checks

Use Node.js 24 for the build and tests. From the repository root:

```sh
cd service && npm install && npx rollup -c rollup.config.js && cd ..
cd mods && npm install && npm run build && cd ..
cd standalone/service && npm install && npm run build && npm test
```

Use an actual Node.js 4.4.3 binary for the service compatibility checks, from
`standalone/service`:

```sh
/path/to/node-v4.4.3/bin/node test/node4-parse.cjs dist/index.js
/path/to/node-v4.4.3/bin/node test/node4-smoke.cjs entry.js
```

The smoke test loads the actual bundle/dependencies and verifies HTTP 200 and
`canConnectToDaemon: true` from the local service. Tizen hardware APIs are fixtures;
the DIAL discovery listener is skipped to avoid LAN broadcasts. Ports 8001 and
8100 must be free. This test does not prove SDB/CDP or video playback on a TV.
Signed release packaging still requires the normal release workflow/certificate.

References: [Samsung web engine versions](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html),
[Chromium M63 protocol](https://chromium.googlesource.com/chromium/src/+/63.0.3239.132/third_party/WebKit/Source/core/inspector/browser_protocol.json),
[Tizen service lifecycle](https://github.com/Samsung/tizen-docs/blob/master/docs/application/web/guides/applications/service-app.md).
