# Externalize server config to `servers.json` — design

**Date:** 2026-06-09
**Status:** Approved
**Files:** `public/example_index.html`, `public/servers.example.json` (new), `.gitignore`, `README.md`

## Goal

Stop requiring users to edit the HTML to configure their servers. Move the
`servers` array out of `public/example_index.html` into an external
`public/servers.json` that the page fetches at load time. No backend change.

## Why this approach

The container runs nginx + node together. Per `nginx.conf`, nginx serves
everything under `/app/public` statically at `/` and only proxies `/api/` to the
node backend. Docker users already mount `/app/public/`. Therefore a JSON file
dropped into `public/` is served automatically at `/servers.json` with **no
backend change and no new mount**. The server list is already fully public today
(it ships inside the HTML the browser downloads), so externalizing it exposes
nothing new.

Rejected alternatives:
- **`/api/servers` backend endpoint** — adds node code + a new mount for an
  equivalent result; the data is already client-visible, so server-side serving
  buys nothing here.
- **YAML config** — friendlier comments, but needs a parser library in a project
  that deliberately has no frontend build step. `JSON.parse` is native.

## Scope

- **In scope:** externalize the `servers` array only (name, domain, port,
  craftyId, image, maps). Mirrors the existing `.env` / `.env.example`
  convention.
- **Out of scope (per chosen tier):** page chrome (title, background image,
  refresh interval) stays hardcoded; the open `/api/status?server=<anything>`
  proxy behavior is **not** changed/hardened here.

## 1. Config file

New repo file **`public/servers.example.json`** — a JSON array, same shape as
today's inline `servers` array:

```json
[
  {
    "name": "Example 1",
    "domain": "mc.example.com",
    "port": 25565,
    "craftyId": "00000000-0000-0000-0000-000000000000",
    "image": "/images/servers/example1.jpg",
    "maps": {
      "dynmap": "https://mc.example.com/maps/survival/",
      "bluemap": "https://mc.example.com/maps/survival-3d/"
    }
  },
  {
    "name": "Example 2",
    "domain": "mc2.example.com",
    "port": 25565,
    "craftyId": "00000000-0000-0000-0000-000000000000",
    "image": "/images/servers/example2.jpg",
    "maps": {
      "dynmap": "https://mc.example.com/maps/survival2/",
      "bluemap": "https://mc.example.com/maps/survival2-3d/"
    }
  }
]
```

- The live file is **`public/servers.json`**, which is **gitignored** (it can
  contain private domains / Crafty IDs) — exactly like `.env`.
- Deployers copy `servers.example.json` → `servers.json` (or drop their own into
  the mounted `public/`). The HTML is never edited.

### Schema

| Field | Required | Type | Default / notes |
|---|---|---|---|
| `name` | yes | string | shown as the card heading |
| `domain` | yes | string | passed to `/api/status` |
| `port` | no | number | defaults to `25565` |
| `craftyId` | no | string | omitted → no Crafty stats for that card |
| `image` | no | string | omitted → card image is not rendered |
| `maps` | no | object | `{ dynmap?, bluemap? }`; only present URLs get a map button |

## 2. Frontend — load instead of hardcode (`public/example_index.html`)

- Remove the hardcoded `const servers = [ ... ]` literal. Declare `let servers = []`.
- Add `loadServers()`:
  - `const res = await fetch('/servers.json', { cache: 'no-cache' })` — the
    `no-cache` revalidation means edits to `servers.json` appear on reload
    without a stale cache.
  - If `!res.ok` → throw `Error('servers.json not found (HTTP <status>)')`.
  - Parse JSON (a parse failure throws — caught by the caller).
  - If the parsed value is not an array → throw
    `Error('servers.json must be a JSON array')`.
  - Normalize each entry: require `name` and `domain` (drop entries missing
    either, with a `console.warn`); default `port` to `25565`; leave `craftyId`,
    `image`, `maps` as-is (may be undefined).
  - Return the normalized array.
- New `init()` startup, replacing the current bare `updateServerStatuses()` +
  `setInterval(...)` at the bottom of the script:

  ```js
  async function init() {
      try {
          servers = await loadServers();
      } catch (e) {
          showConfigError(e.message);
          return; // don't start polling with no config
      }
      if (servers.length === 0) {
          showConfigError('No servers configured.');
          return;
      }
      updateServerStatuses();
      setInterval(updateServerStatuses, 60000);
  }
  init();
  ```

  This composes cleanly with the in-place-update refactor already shipped:
  `serverCards` is built on the first `updateServerStatuses()` call, which now
  happens after the config has loaded.

## 3. Graceful failure

- **`showConfigError(message)`** renders a single message block into
  `#serverGrid` instead of leaving a blank page, e.g.:
  *"Couldn't load server configuration: &lt;message&gt;. Create
  `public/servers.json` — see `servers.example.json`."* The message text is set
  via `textContent` (no HTML injection).
- Covered failure cases: missing file (404), malformed JSON, not-an-array, empty
  array.

## 4. Card-builder guarding (`buildServerCard`)

Because the config is now hand-edited, guard the optional fields so a missing
field can't throw at build time (today `buildServerCard` reads
`server.maps.dynmap`/`.bluemap` and `server.image` unconditionally):

- **Image:** render the `<img class="server-image">` only when `server.image` is
  a non-empty string; otherwise omit it.
- **Maps:** `const maps = server.maps || {};` then render the 2D button only when
  `maps.dynmap` exists and the 3D button only when `maps.bluemap` exists. If
  neither exists, the `.map-links` row contains no buttons.

These are the only changes to `buildServerCard`; the static/dynamic split and
all dynamic-field handling from the prior refactor are unchanged.

## 5. Docs & deploy

- **`README.md`:** replace *"Edit the servers array in the frontend code to add
  your Minecraft servers"* with the `servers.json` workflow (copy
  `servers.example.json` → `servers.json`, edit it). Update the Docker section to
  note that `servers.json` lives in the mounted `public/` alongside `index.html`
  and images.
- **`.gitignore`:** add `public/servers.json` (keep `servers.example.json`
  tracked).
- **Dockerfile / nginx.conf / start.sh:** no change. nginx already serves
  `public/` statically; the image ships `servers.example.json` only, and
  deployers supply the real `servers.json` (the same way they already supply
  their own `index.html`).

## Verification

Serve `public/` with a static server and drive a headless browser:

1. Valid `servers.json` present → the expected cards render from it.
2. No `servers.json` (404) → the friendly config-error message shows; no console
   exception; polling does not start.
3. Malformed JSON (e.g. trailing comma) → friendly config-error message.
4. An entry missing `image` and/or `maps` → its card renders without throwing
   (no image; only the available map buttons, or none).

## Live-deployment note

As with the prior change, the production `index.html` is a separate, gitignored
file that must receive the same frontend changes manually; this work edits the
`example_index.html` template.
