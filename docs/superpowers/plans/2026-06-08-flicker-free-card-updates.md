# Flicker-Free In-Place Card Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the 60s refresh from blanking and rebuilding the whole server grid; update each card's dynamic fields in place instead.

**Architecture:** Split the current string-returning `createServerCard` into `buildServerCard(server)` (runs once, creates the DOM node + returns references to its dynamic sub-elements) and `applyStatus(refs, server, status)` (runs every cycle, mutates only the dynamic fields). `updateServerStatuses` builds all cards once on first call, then fetches every server in parallel and patches cards in place.

**Tech Stack:** Plain browser JavaScript inside a single static file (`public/example_index.html`). Node/Express backend (`server.js`) serves the page but is **not** modified. No test framework exists in this repo; verification is manual in the browser (spec-approved), with an optional Playwright smoke test.

---

## Important context for the implementer

- **Spec:** `docs/superpowers/specs/2026-06-08-flicker-free-card-updates-design.md`. Read it first.
- **No backend change.** Do not touch `server.js`.
- **No new dependencies** in the required path. The card's rendered appearance must be byte-for-byte identical to today once data loads — this is a mechanism change, not a visual one.
- **Live-deployment caveat:** the production `index.html` is a separate, gitignored file. After this lands, the same edit must be mirrored there manually. Out of scope for this plan, but call it out when finishing.
- **Helpers that already exist and must keep working unchanged:** `formatSize`, `formatUptime`, `simplifyVersion`, `getServerState`, `getTypeLabel`, `copyDomain`, `showCopyFeedback`, `escapeHtml`, `checkServerStatus`, `showMap`, `closeMap`, `toggleFullscreen`. `applyStatus` calls `getServerState`, `getTypeLabel`, `formatUptime`, `formatSize`, `simplifyVersion`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `public/example_index.html` | Modify (`<script>` block only) | Replace teardown-and-rebuild rendering with build-once + update-in-place. |
| `tests/flicker.spec.js` | Create (**optional**, Task 5 only) | Playwright smoke test asserting card node identity + no image reload across a cycle. |

## How to run the page locally (needed for verification)

```powershell
npm install
Copy-Item .env.example .env      # dummy values are fine; Crafty/MC will just report offline
npm start                        # serves on http://localhost:3000
```

Then open **http://localhost:3000/example_index.html** (there is no `index.html` in `public/`, so `/` will not serve the page — use the full filename). With no real servers configured the example cards render as **Offline**; that still exercises the flicker fix because the grid still rebuilt itself every cycle before this change.

---

### Task 1: Add `buildServerCard` and `applyStatus` (additive, page behavior unchanged)

This task only **adds** two new functions. `createServerCard` stays in place and in use, so the page behaves exactly as before. This keeps a green checkpoint before the wiring change in Task 2.

**Files:**
- Modify: `public/example_index.html` — insert immediately **above** the `function createServerCard(server, status) {` line (currently ~line 677).

- [ ] **Step 1: Insert the two new functions**

Paste this block directly above the existing `function createServerCard(...)`:

```javascript
    // Build a card's static structure ONCE and return references to the
    // sub-elements that change each refresh. Static parts (image, name, domain,
    // map links) are never touched again; dynamic parts are filled by
    // applyStatus(). Cards persist across refreshes => no flash, no image
    // reload, and the open-map highlight survives.
    function buildServerCard(server) {
        const escapedName = server.name.replace(/'/g, "\\'");

        const el = document.createElement('div');
        el.className = 'server-card';
        el.innerHTML = `
            <img src="${server.image}" alt="${escapedName}" class="server-image">

            <div class="header-row">
                <div class="server-identity">
                    <img alt="" class="server-avatar" hidden>
                    <h2>${server.name}</h2>
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

            <div class="map-links">
                <span class="map-link"
                      onclick="showMap(\`${escapedName}\`, \`${server.maps.dynmap}\`, '2D')"
                      data-url="${server.maps.dynmap}">
                    2D Map
                </span>
                <span class="map-link"
                      onclick="showMap(\`${escapedName}\`, \`${server.maps.bluemap}\`, '3D')"
                      data-url="${server.maps.bluemap}">
                    3D Map
                </span>
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

    // Update ONLY the dynamic fields of an already-built card. Uses textContent
    // for all text (so a hostile MOTD can't inject HTML) and toggles `hidden`
    // for the optional avatar / type badge instead of inserting/removing nodes.
    function applyStatus(refs, server, status) {
        const craftyStats = status.craftyStats || {};
        const state = getServerState(status);
        const typeLabel = getTypeLabel(craftyStats.type);

        // Status badge: label + color class.
        refs.status.className = `server-status ${state.cls}`;
        refs.status.textContent = state.label;

        // Type badge (e.g. "Java"); hidden when unknown.
        if (typeLabel) {
            refs.typeBadge.textContent = typeLabel;
            refs.typeBadge.hidden = false;
        } else {
            refs.typeBadge.hidden = true;
        }

        // Crafty icon avatar. Only accept a strict base64 string, and only
        // reassign src when it actually changes so the image never reloads.
        const iconSrc = (craftyStats.icon && /^[A-Za-z0-9+/=]+$/.test(craftyStats.icon))
            ? `data:image/png;base64,${craftyStats.icon}` : null;
        if (iconSrc) {
            if (refs.avatar.getAttribute('src') !== iconSrc) refs.avatar.src = iconSrc;
            refs.avatar.hidden = false;
        } else {
            refs.avatar.removeAttribute('src');
            refs.avatar.hidden = true;
        }

        // MOTD — textContent keeps it inert.
        refs.motd.textContent = status.motd;

        // Players.
        refs.players.textContent = status.online
            ? `Players: ${status.players.online}/${status.players.max}`
            : 'Players: 0/0';

        // Uptime.
        const uptimeDisplay = status.online
            ? (craftyStats.uptime ? formatUptime(craftyStats.uptime) : 'Unknown')
            : 'Offline';
        refs.uptime.textContent = `Uptime: ${uptimeDisplay}`;

        // World size.
        refs.worldSize.textContent = `Size: ${formatSize(craftyStats.worldSize)}`;

        // Version (ping-derived).
        refs.version.textContent = `Version: ${status.version ? simplifyVersion(status.version) : 'Unknown'}`;
    }
```

- [ ] **Step 2: Verify the page still loads unchanged**

With the app running (`npm start`), open http://localhost:3000/example_index.html and open DevTools.
Expected: cards render exactly as before; **zero** console errors (a syntax error in the inserted block would surface here). The new functions are defined but not yet called.

Quick console confirmation that both parse and are callable:

```javascript
typeof buildServerCard === 'function' && typeof applyStatus === 'function'
```

Expected console output: `true`

- [ ] **Step 3: Commit**

```bash
git add public/example_index.html
git commit -m "Add buildServerCard/applyStatus helpers for in-place updates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire in in-place updates and remove `createServerCard`

Now switch `updateServerStatuses` to build once + patch in place + fetch in parallel, and delete the now-unused `createServerCard`.

**Files:**
- Modify: `public/example_index.html` — replace the whole `async function updateServerStatuses() { ... }` body (locate it by that signature; ~line 845 after Task 1's insertion).
- Modify: `public/example_index.html` — delete the entire `function createServerCard(server, status) { ... }` (the original card-string builder; it ends just above `async function updateServerStatuses`).

- [ ] **Step 1: Replace `updateServerStatuses` with the in-place version**

Find `async function updateServerStatuses() {` and replace the **entire function** (through its closing `}`) with this, which also introduces the module-level `serverCards` cache on the line directly above it:

```javascript
    // Built once on first render, then updated in place every cycle.
    // One entry per configured server: { server, el, refs }.
    let serverCards = null;

    async function updateServerStatuses() {
        const serverGrid = document.getElementById('serverGrid');

        // First run only: build every card once and append in a single pass.
        if (!serverCards) {
            serverGrid.innerHTML = '';
            serverCards = servers.map(server => {
                const built = buildServerCard(server);
                serverGrid.appendChild(built.el);
                return { server, el: built.el, refs: built.refs };
            });
        }

        // Fetch all servers in parallel (was a sequential await-in-loop).
        // checkServerStatus never rejects — it returns an offline object on error.
        const statuses = await Promise.all(
            serverCards.map(card =>
                checkServerStatus(card.server.domain, card.server.port, card.server.craftyId))
        );

        // Patch each card in place — no teardown, no rebuild.
        serverCards.forEach((card, i) => applyStatus(card.refs, card.server, statuses[i]));

        // Recompute the aggregate stats panel (same math as before).
        let totalCpu = 0;
        let totalMemoryUsed = 0;
        let totalMemoryMax = 0;
        let totalWorldSize = 0;
        let serverCount = 0;

        statuses.forEach(status => {
            if (status.online && status.craftyStats) {
                totalCpu += status.craftyStats.cpu || 0;
                if (status.craftyStats.memory) {
                    if (status.craftyStats.memory.used) totalMemoryUsed += status.craftyStats.memory.used;
                    if (status.craftyStats.memory.max) totalMemoryMax += status.craftyStats.memory.max;
                }
                if (status.craftyStats.worldSize) totalWorldSize += status.craftyStats.worldSize;
                serverCount++;
            }
        });

        document.getElementById('cpuUsage').textContent =
            `${(serverCount > 0 ? totalCpu : 0).toFixed(1)}%`;

        document.getElementById('memoryUsage').textContent =
            serverCount > 0 ?
            `${formatSize(totalMemoryUsed)} / ${formatSize(totalMemoryMax)}` :
            '0 GB / 0 GB';

        document.getElementById('totalWorldSize').textContent =
            serverCount > 0 ? formatSize(totalWorldSize) : '0 GB';
    }
```

- [ ] **Step 2: Delete the now-unused `createServerCard`**

Remove the entire `function createServerCard(server, status) { ... }` block (the original HTML-string builder). Nothing references it anymore — `buildServerCard` + `applyStatus` replace it.

- [ ] **Step 3: Confirm `createServerCard` is gone and nothing references it**

Run:

```bash
git grep -n "createServerCard" -- public/example_index.html
```

Expected: **no output** (zero matches).

- [ ] **Step 4: Verify in the browser — cards update in place**

Restart/refresh http://localhost:3000/example_index.html with DevTools open. In the console:

```javascript
// Tag the first card node, then force a refresh cycle.
document.querySelector('.server-card').dataset.marker = 'kept';
await updateServerStatuses();
document.querySelector('.server-card').dataset.marker;   // node survived?
```

Expected console output: `'kept'` — the original node is still there (before this change it would be `undefined`, proving the card was destroyed and rebuilt).

Also confirm visually:
- The grid does **not** blank to empty between refreshes (call `await updateServerStatuses()` a few times — cards stay put, only text/badges change).
- Both example cards update together, not one-after-another.

Expected: zero console errors.

- [ ] **Step 5: Verify the open-map highlight survives a refresh (the bug fixed for free)**

In the page, click a card's **2D Map** button (the map panel opens and that `.map-link` gets the `.active` highlight). Then in the console:

```javascript
await updateServerStatuses();
document.querySelectorAll('.map-link.active').length;
```

Expected console output: `1` — the active highlight persists across the refresh (before this change it was lost because the card was rebuilt).

- [ ] **Step 6: Commit**

```bash
git add public/example_index.html
git commit -m "Update server cards in place to remove 60s refresh flicker

Build cards once, fetch all servers in parallel, and patch only the
dynamic fields each cycle instead of wiping and rebuilding the grid.
Also preserves the active map highlight across refreshes and renders
MOTD via textContent. Removes the now-unused createServerCard.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verify the original flicker symptom is gone (formal spec verification)

This is the spec's verification, done deliberately. No code is committed here — the interval change is temporary and reverted.

**Files:**
- Temporarily edit (then revert): `public/example_index.html` — the `setInterval(updateServerStatuses, 60000)` line near the end of the script.

- [ ] **Step 1: Temporarily speed up the refresh**

Change `setInterval(updateServerStatuses, 60000);` to `setInterval(updateServerStatuses, 3000);` and reload the page.

- [ ] **Step 2: Observe for ~15 seconds**

Expected:
- The card grid never flashes to empty; cards stay in place every 3s.
- No sequential one-by-one pop-in.
- Server images do not visibly reload each cycle. (Optional sharper check: drop any `.jpg` into `public/images/servers/example1.jpg` and `example2.jpg` first, then in DevTools → Network filter by Img and confirm no repeated requests each cycle.)

- [ ] **Step 3: Revert the interval**

Change `3000` back to `60000`. Confirm `git diff -- public/example_index.html` shows **no changes** (the revert is clean and nothing from Task 3 is committed).

---

### Task 4: Finish-up note (no code)

- [ ] **Step 1: Flag the live-deployment mirror**

State explicitly in the completion summary that the production `index.html` (separate, gitignored) must receive the same `buildServerCard` / `applyStatus` / `updateServerStatuses` changes manually. This plan only edits the `example_index.html` template.

---

### Task 5 (OPTIONAL): Playwright smoke test

Only do this if an automated regression guard is wanted. It **adds a dev dependency** (`@playwright/test`) and a `tests/` folder, which the spec marked optional — skip it otherwise. It runs against a static file server (no backend needed) and mocks `/api/status`.

**Files:**
- Create: `tests/flicker.spec.js`

- [ ] **Step 1: Install Playwright (dev-only)**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create the test**

Create `tests/flicker.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

// Run a static server for ./public in another terminal before this test:
//   npx http-server ./public -p 8080
// The backend is not needed; /api/status is mocked below.
test('cards update in place: node identity preserved and image not reloaded', async ({ page }) => {
    await page.route('**/api/status*', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            online: true,
            players: { online: 3, max: 20 },
            version: '1.21.1',
            motd: 'Mock server',
            latency: 10,
            craftyStats: {
                uptime: null, cpu: 1, memory: { used: 0, max: 0 }, worldSize: 0,
                running: true, crashed: false, waitingStart: false, updating: false,
                type: 'minecraft-java', icon: null
            }
        })
    }));

    const imageRequests = [];
    page.on('request', req => { if (req.resourceType() === 'image') imageRequests.push(req.url()); });

    await page.goto('http://localhost:8080/example_index.html');
    await expect(page.locator('.server-card').first()).toBeVisible();

    // Tag the first card, capture image-request count, then force a second cycle.
    await page.evaluate(() => { document.querySelector('.server-card').dataset.marker = 'kept'; });
    const imagesAfterFirstRender = imageRequests.length;

    await page.evaluate(() => updateServerStatuses());
    await page.waitForTimeout(500);

    // Card node survived the refresh (updated in place, not rebuilt):
    await expect(page.locator('.server-card').first()).toHaveAttribute('data-marker', 'kept');
    // No card image was re-requested on the second cycle:
    expect(imageRequests.length).toBe(imagesAfterFirstRender);
});
```

- [ ] **Step 3: Run it**

In one terminal: `npx http-server ./public -p 8080`
In another: `npx playwright test tests/flicker.spec.js`
Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add tests/flicker.spec.js package.json package-lock.json
git commit -m "Add optional Playwright smoke test for in-place card updates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** two-phase lifecycle (Task 1) ✓; module state cache (Task 2 Step 1) ✓; first-run build + parallel fetch + aggregate recompute (Task 2 Step 1) ✓; loading state (Task 1 placeholders `…`/`Loading…`) ✓; active-map-highlight fix (Task 2 Step 5) ✓; MOTD via textContent (Task 1 `applyStatus`) ✓; scope = `example_index.html` only, no backend ✓; live-`index.html` mirror flag (Task 4) ✓; verification = manual primary + optional Playwright (Tasks 3 & 5) ✓.
- **Type/name consistency:** `buildServerCard` returns `{ el, refs }`; `refs` keys (`avatar`, `typeBadge`, `status`, `motd`, `players`, `uptime`, `worldSize`, `version`) are exactly the keys `applyStatus` reads; `serverCards` entries are `{ server, el, refs }` and only `.server`/`.refs` are used downstream. Consistent across tasks.
- **No placeholders:** every code step contains the full code to paste; verification steps give exact commands and expected output.
