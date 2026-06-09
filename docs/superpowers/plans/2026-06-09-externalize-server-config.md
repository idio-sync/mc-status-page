# Externalize Server Config to servers.json — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the hardcoded `servers` array out of `public/example_index.html` into an external `public/servers.json` the page fetches at load, so users configure servers without editing HTML.

**Architecture:** nginx already serves `public/` statically, so a JSON file there is reachable at `/servers.json` with no backend change. The frontend fetches and validates it on startup, renders a friendly message on failure, and guards the card builder against missing optional fields. Mirrors the existing `.env` / `.env.example` convention.

**Tech Stack:** Plain browser JavaScript in a single static file (`public/example_index.html`); static JSON config. No backend change, no build step, no new dependencies. No test framework exists in this repo; verification is static (`node --check`, `JSON.parse`) plus a headless-browser runtime check run by the controller.

---

## Important context for the implementer

- **Spec:** `docs/superpowers/specs/2026-06-09-externalize-server-config-design.md`. Read it first.
- You are on branch `externalize-server-config`. Do NOT touch `server.js`, `nginx.conf`, `Dockerfile`, or `start.sh`.
- This builds on a prior refactor: cards are built once by `buildServerCard(server)` and patched by `applyStatus(...)`; `updateServerStatuses()` builds `serverCards` from the global `servers` on its first call. Your change makes `servers` load from JSON before that first call.
- The repo ships `example_index.html` (a template), not `index.html`. The live deployment's real `index.html` is separate/gitignored and must be updated manually later (flag it when finishing).
- Line numbers below are from the current file; if they've shifted, locate by the quoted text.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `public/servers.example.json` | Create | Tracked example config; deployers copy it to `servers.json`. |
| `.gitignore` | Modify | Ignore the real `public/servers.json` (may hold private domains/IDs). |
| `public/example_index.html` | Modify (`<script>` only) | Load + validate config, guard card builder, friendly error on failure. |
| `README.md` | Modify | Document the `servers.json` workflow instead of editing HTML. |

## How to run locally (for verification)

A dependency-free static server is enough (the page only needs `/servers.json` and the page itself; `/api/status` 404s into the offline fallback). Example used during verification:

```
node c:/tmp/static-server.js "c:/Users/Jake/Git/mc-status-page/mc-status-page/public" 8123
# then open http://localhost:8123/example_index.html
```

(Any static file server works. `npm start` also works but needs deps + a `.env`.)

---

### Task 1: Add `servers.example.json` and gitignore the real file

**Files:**
- Create: `public/servers.example.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `public/servers.example.json`**

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

- [ ] **Step 2: Verify it is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/servers.example.json','utf8')); console.log('valid JSON')"`
Expected: `valid JSON`

- [ ] **Step 3: Append the gitignore entry**

Add to the end of `.gitignore`:

```
# Server list (copy public/servers.example.json to public/servers.json)
public/servers.json
```

- [ ] **Step 4: Confirm a real servers.json would be ignored**

Run: `printf "[]" > public/servers.json && git check-ignore public/servers.json && rm public/servers.json`
Expected: prints `public/servers.json` (proves it's ignored), then removes the temp file.

- [ ] **Step 5: Commit**

```bash
git add public/servers.example.json .gitignore
git commit -m "Add servers.example.json and gitignore real servers.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Frontend — load config on startup, guard the card builder

All edits are inside the single `<script>` block of `public/example_index.html`. Apply all four replacements, then verify and commit once (each replacement individually would leave the page half-wired, so this is one task).

**Files:**
- Modify: `public/example_index.html`

- [ ] **Step 1: Replace the hardcoded `servers` array with an empty `let`**

Replace this (currently ~lines 521–546):

```javascript
    const servers = [
        
		{
            name: "Example 1",
            domain: "mc.example.com",
            port: 25565,
			craftyId:"00000000-0000-0000-0000-000000000000",
            image: "/images/servers/example1.jpg",
            maps: {
                dynmap: "https://mc.example.com/maps/survival/",
                bluemap: "https://mc.example.com/maps/survival-3d/"
            }
        },
		{
            name: "Example 2",
            domain: "mc2.example.com",
            port: 25565,
            craftyId:"00000000-0000-0000-0000-000000000000",
			image: "/images/servers/example2.jpg",
            maps: {
                dynmap: "https://mc.example.com/maps/survival2/",
                bluemap: "https://mc.example.com/maps/survival2-3d/"
            }
        }
        // Add more servers as needed
    ];
```

With this:

```javascript
    // Server list is loaded from /servers.json at startup (see loadServers /
    // init at the bottom of this script). Edit servers.json — not this file.
    let servers = [];
```

- [ ] **Step 2: Replace `buildServerCard` with a version that guards optional fields**

Replace the entire current `buildServerCard` function (from `function buildServerCard(server) {` through its closing `}`, currently ~lines 682–745) with:

```javascript
    function buildServerCard(server) {
        const escapedName = server.name.replace(/'/g, "\\'");
        const maps = server.maps || {};

        // Optional fields (config is hand-edited): render the image only when
        // provided, and render each map button only when its URL exists.
        const imageHtml = server.image
            ? `<img src="${escapeHtml(server.image)}" alt="${escapedName}" class="server-image">`
            : '';
        const mapLinksHtml = `
                ${maps.dynmap ? `<span class="map-link"
                      onclick="showMap(\`${escapedName}\`, \`${maps.dynmap}\`, '2D')"
                      data-url="${maps.dynmap}">
                    2D Map
                </span>` : ''}
                ${maps.bluemap ? `<span class="map-link"
                      onclick="showMap(\`${escapedName}\`, \`${maps.bluemap}\`, '3D')"
                      data-url="${maps.bluemap}">
                    3D Map
                </span>` : ''}`;

        const el = document.createElement('div');
        el.className = 'server-card';
        el.innerHTML = `
            ${imageHtml}

            <div class="header-row">
                <div class="server-identity">
                    <img alt="" class="server-avatar" hidden>
                    <h2>${escapeHtml(server.name)}</h2>
                </div>
                <div class="header-status">
                    <span class="type-badge" hidden></span>
                    <div class="server-status">…</div>
                </div>
            </div>

            <div class="info-row">
                <div class="info-item">
                    <span class="info-label">Domain:</span>
                    <span class="domain" onclick="copyDomain('${server.domain}')">${server.domain}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">MOTD:</span>
                    <span class="motd">Loading…</span>
                </div>
            </div>

            <div class="info-row">
                <span class="player-count">Players: …</span>
                <span class="uptime">Uptime: …</span>
                <span class="world-size">Size: …</span>
                <span class="version">Version: …</span>
            </div>

            <div class="map-links">${mapLinksHtml}
            </div>
        `;

        const refs = {
            avatar: el.querySelector('.server-avatar'),
            typeBadge: el.querySelector('.type-badge'),
            status: el.querySelector('.server-status'),
            motd: el.querySelector('.motd'),
            players: el.querySelector('.player-count'),
            uptime: el.querySelector('.uptime'),
            worldSize: el.querySelector('.world-size'),
            version: el.querySelector('.version'),
        };

        return { el, refs };
    }
```

(Only `image` and `maps` handling changed; the static/dynamic split and `refs` are identical to before.)

- [ ] **Step 3: Replace the startup block at the bottom with loader + error handling + init**

Replace this (currently ~lines 924–928):

```javascript
    // Initial update
    updateServerStatuses();

    // Update every 60 seconds
    setInterval(updateServerStatuses, 60000);
```

With this:

```javascript
    // Load the server list from /servers.json (served statically from public/).
    // no-cache so edits to servers.json appear on reload without a stale copy.
    async function loadServers() {
        const res = await fetch('/servers.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`servers.json not found (HTTP ${res.status})`);
        const data = await res.json(); // throws on malformed JSON
        if (!Array.isArray(data)) throw new Error('servers.json must be a JSON array');

        // Keep only entries with the required fields; default the port.
        return data
            .filter(s => {
                const ok = s && typeof s.name === 'string' && typeof s.domain === 'string';
                if (!ok) console.warn('Skipping server entry missing name/domain:', s);
                return ok;
            })
            .map(s => ({ ...s, port: s.port || 25565 }));
    }

    // Render a single friendly message into the grid instead of a blank page.
    function showConfigError(message) {
        const serverGrid = document.getElementById('serverGrid');
        serverGrid.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'server-card';
        const heading = document.createElement('h2');
        heading.textContent = 'Configuration error';
        const p = document.createElement('p');
        p.textContent = `Couldn't load server configuration: ${message} ` +
            'Create public/servers.json (see servers.example.json).';
        card.appendChild(heading);
        card.appendChild(p);
        serverGrid.appendChild(card);
    }

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

- [ ] **Step 4: Verify the script still parses**

Extract the contents of the single `<script>` … `</script>` block in `public/example_index.html` to `c:\tmp\mc-check.js`, then run `node --check c:\tmp\mc-check.js`. Expected: exit 0 (no output). Delete the temp file.

- [ ] **Step 5: Confirm the hardcoded array is gone**

Run: `git grep -n "const servers = \[" -- public/example_index.html`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add public/example_index.html
git commit -m "Load server list from servers.json instead of hardcoding in HTML

Replace the inline servers array with a fetch of /servers.json at startup,
with validation and a friendly on-page error when the config is missing or
malformed. Guard buildServerCard so a missing image/maps no longer throws.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the config instruction line**

Replace this line:

```
4. Edit the servers array in the frontend code to add your Minecraft servers
```

With:

```
4. Configure your servers: copy `public/servers.example.json` to `public/servers.json` and edit it (an array of server objects: `name`, `domain`, optional `port` (default 25565), `craftyId`, `image`, and `maps.dynmap` / `maps.bluemap`). No HTML editing required. (`public/servers.json` is gitignored.)
```

- [ ] **Step 2: Update the Docker step that lists what goes in `public`**

Replace this line:

```
3. Place exited index.html and images in `public` folder passed through on host
```

With:

```
3. Place your `index.html`, `servers.json` (copied from `servers.example.json`), and images in the `public` folder passed through on the host
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document servers.json config workflow in README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Runtime verification (controller-run; the spec's verification)

This is run by the controller with a static server + headless browser. No code is committed here.

- [ ] **Step 1: Valid config renders cards**

Copy `public/servers.example.json` to `public/servers.json`, serve `public/`, load `example_index.html`, and confirm: 2 `.server-card` elements render, status badges resolve (offline in this harness), and no uncaught console exception. Remove the temp `public/servers.json` afterward.

- [ ] **Step 2: Missing config → friendly error**

With no `public/servers.json` present, reload and confirm: the grid shows the "Configuration error … Create public/servers.json" message (a `.server-card` containing an `h2` "Configuration error"), and `setInterval` polling did NOT start (no repeated `/servers.json` or `/api/status` requests).

- [ ] **Step 3: Malformed JSON → friendly error**

Write `public/servers.json` containing invalid JSON (e.g. `[{ "name": "x", }]` with a trailing comma), reload, and confirm the friendly config-error message appears (no blank page, no uncaught throw). Remove the temp file afterward.

- [ ] **Step 4: Entry missing image/maps → card still renders**

Write `public/servers.json` = `[{ "name": "NoExtras", "domain": "mc.example.com" }]`, reload, and confirm a single card renders with no `.server-image` and no `.map-link` buttons, and no uncaught throw. Remove the temp file afterward.

---

### Task 5: Finish-up note (no code)

- [ ] **Step 1:** In the completion summary, flag that the production `index.html` (separate, gitignored) must receive the same frontend changes manually, and that deployers now need a `servers.json` in their mounted `public/`.

---

## Self-review notes

- **Spec coverage:** config file + gitignore (Task 1) ✓; `loadServers` with no-cache fetch, array check, required-field filter, port default (Task 2 Step 3) ✓; `init()` startup replacing bare call (Task 2 Step 3) ✓; `showConfigError` for 404/malformed/non-array/empty (Task 2 Step 3) ✓; `buildServerCard` image + maps guarding (Task 2 Step 2) ✓; README + Docker docs (Task 3) ✓; gitignore (Task 1) ✓; no backend/nginx/Docker change ✓; verification cases (Task 4) map to spec §Verification ✓; live-index.html flag (Task 5) ✓.
- **Placeholder scan:** every code step has full content; verification steps give exact files/assertions. No TBD/TODO.
- **Type/name consistency:** `loadServers` returns the array assigned to global `servers`; `init` reads `servers.length`; `buildServerCard` consumes `server.image`/`server.maps`/`server.name`/`server.domain`; `showConfigError(message)` signature matches both call sites; `refs` keys unchanged from the prior refactor and still consumed by `applyStatus`.
