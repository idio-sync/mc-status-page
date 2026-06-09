# Flicker-free in-place card updates — design

**Date:** 2026-06-08
**Status:** Approved
**Files:** `public/example_index.html` (frontend only — no backend change)

## Goal

Eliminate the visible flicker, blank-grid flash, and slow sequential pop-in that
happen every 60s refresh cycle. Cards should update smoothly in place instead of
being torn down and rebuilt.

## Problem

`updateServerStatuses()` rebuilds the entire grid every cycle:

1. `serverGrid.innerHTML = ''` wipes every card to empty at the start of each
   cycle. The grid collapses to zero height, then repopulates — the flash, plus
   a scroll jump.
2. The fetch loop is **sequential** (`await` inside `for...of`). With each ping
   allowed up to 5s, cards pop in one-by-one over several seconds.
3. `serverGrid.innerHTML += cardHTML` re-serializes and rebuilds the entire
   grid's DOM on every append (O(N²)). Existing card nodes are destroyed and
   recreated, so images reload, `:hover` resets, and the active map highlight
   (`.map-link.active`) desyncs from any open map.

"Flicker" is these three coupled problems: wipe-to-empty, sequential pop-in, and
full DOM teardown.

## 1. Two-phase card lifecycle

Split the current `createServerCard(server, status)` — which returns an HTML
string re-parsed every cycle — into two functions:

- **`buildServerCard(server)`** — runs **once** on first load. Creates the
  card's DOM node with its static structure (server image, identity container +
  `<h2>` name, domain element with copy handler, the two map-link buttons) plus
  empty slots for the dynamic fields. Returns `{ el, refs }` where `refs` holds
  direct references to each dynamic sub-element.
- **`applyStatus(refs, server, status)`** — runs **every cycle**. Mutates only
  the dynamic fields in place.

Dynamic fields updated by `applyStatus` (everything that can change between
cycles):

| Field | How it's set |
|---|---|
| status badge | `textContent` = label, `className` = `server-status <cls>` |
| type badge | `textContent` + show/hide (hidden when `type` null) |
| icon avatar | `src` from validated base64 + show/hide (hidden when `icon` null) |
| players | `textContent` |
| uptime | `textContent` |
| world size | `textContent` |
| version | `textContent` |
| MOTD | `textContent` |

Static fields built once and never touched again: server image, server name,
domain (+ copy handler), the 2D/3D map-link buttons.

## 2. State held between cycles

A module-level array parallel to `servers`, each entry `{ server, el, refs }`.
The `servers` config is static per page load, so there is no add/remove
reconciliation — build once in order, update in place thereafter.

## 3. Rewritten `updateServerStatuses()`

- **First call only:** build all cards via `buildServerCard` and append them to
  the grid in a single pass, in a neutral "loading…" state (status badge shows a
  placeholder, dynamic text shows `…`) so the page shows structure instantly
  instead of a blank screen.
- **Every call:** fetch all servers **in parallel**
  (`Promise.all(servers.map(s => checkServerStatus(...)))`) instead of the
  sequential `await`-in-loop, then call `applyStatus` on each card, then
  recompute the aggregate CPU / memory / world-size panel using the same math as
  today (just applied after the parallel results resolve).

`checkServerStatus` already catches its own errors and returns a safe offline
object, so `Promise.all` will not reject; each card always receives a usable
status.

## 4. Bugs fixed as a side effect

- **Active map highlight persists** across refreshes — cards are never
  destroyed, so `.map-link.active` survives. `showMap` / `closeMap` keep working
  unchanged.
- **MOTD becomes XSS-safe** — today it is spliced into card HTML unescaped;
  setting it via `textContent` in `applyStatus` closes that. Existing
  `escapeHtml` (Crafty fields) and the strict base64 icon check are preserved.

## Scope / out of scope

- **In scope:** the refactor above, in `public/example_index.html` only. No
  backend change, no visual redesign, no new dependencies. The card's rendered
  appearance is identical to today.
- **Out of scope:** live player heads, SSE/live updates, and a history store —
  these are separate features from the brainstorming menu and are not part of
  this change.
- **Flag:** the live deployment's real `index.html` is separate from this
  template (gitignored). This frontend change must be mirrored there manually.

## Verification

Temporarily lower the refresh interval (e.g. 60000 → 3000 ms) and confirm in the
browser:

- No flash to an empty grid; cards no longer pop in one-by-one.
- Server images do **not** re-request on each cycle (DevTools → Network).
- With a map open, its active-highlight (`.map-link.active`) persists across a
  refresh.

Optional automated check (Playwright is available): assert that a card DOM node
keeps its identity across a refresh cycle (tag it with a property, confirm the
property survives) and that no `<img>` network re-requests occur. Manual
confirmation is sufficient for a static page.
