# splunk-ide

Electron app for writing Splunk searches.

## Tree

```
main.js                 Electron main
index.html              loads ./renderer.js only
renderer.js             wires renderer/
renderer/               UI modules
styles.css
webview-preload.js
injectors/              guest IIFEs
lib/url-utils.js        shared
lib/main/               main-process helpers
lib/git/
lib/objects/
lib/explorer/
lib/ui/
lib/webview/
test/                   mirrors lib folders, plus helpers/ fixtures/ harness/ smoke/
docs/                   overhaul plans
docs/archive/           git ledgers
```

## Commands

- `npm start`
- `npm run test:unit`
- `npm run test:syntax`
- `npm run test:smoke` — Playwright list is the check; the suite is not a green gate
