# Crafty-driven server card — design

**Date:** 2026-06-07
**Status:** Approved
**Files:** `server.js`, `public/example_index.html`

## Goal

Surface richer Crafty Controller data on each server card: real managed state
(running / crashed / starting / updating), software version, server type, and
the server's Crafty icon.

## 1. Backend — `getServerStatus` restructure (`server.js`)

Currently `getCraftyStatus` is awaited *inside* the ping's success branch, so a
server that fails the ping returns `craftyStats: null` — meaning crashed/stopped
states can never be displayed.

Change: query the Minecraft ping and the Crafty API **independently (in
parallel)** and merge the results.

- `getCraftyStatus` (already self-catching — never rejects) runs regardless of
  ping outcome.
- The ping still determines `online`, `players`, `motd`, `latency`, `favicon`,
  and the ping `version`.
- `craftyStats` is attached to the response whether or not the ping succeeded.
- Existing 30s cache (keyed `host:port`) and Velocity detection are preserved.

`getCraftyStatus` returns these additional fields, in **both** the success and
the catch (error) returns:

| Field | Source | Example |
|---|---|---|
| `running` | `stats.running` | `true` |
| `crashed` | `stats.crashed` | `false` |
| `waitingStart` | `stats.waiting_start` | `false` |
| `updating` | `stats.updating` | `false` |
| `version` | `stats.version` | `"Paper 26.1.2"` |
| `type` | `stats.server_id.type` | `"minecraft-java"` |
| `icon` | `stats.icon` | base64 PNG string, or `null` |

Error/fallback return uses: `running:false, crashed:false, waitingStart:false,
updating:false, version:null, type:null, icon:null`.

## 2. Status badge state machine (frontend)

First match wins:

| Condition | Label | Color |
|---|---|---|
| `crashed` | Crashed | `#b71c1c` |
| `updating` | Updating | `#2196F3` |
| `waitingStart` | Starting… | `#FF9800` |
| `running` OR ping-`online` | Online | `#4CAF50` (existing) |
| else | Offline | `#f44336` (existing) |

Consequences (intended):
- Pingable but not tracked by Crafty → **Online**.
- Cleanly stopped in Crafty, not pingable → **Offline**.
- Crashed in Crafty → **Crashed**.
- No `craftyId` or Crafty fetch failed → fall back to plain ping Online/Offline.

## 3. Version field

Use `craftyStats.version` verbatim (e.g. `"Paper 26.1.2"`) when present;
otherwise fall back to the existing `simplifyVersion(status.version)` from the
ping. `simplifyVersion` is retained for the fallback path.

## 4. Type badge

New pill in `.header-row`, positioned **immediately left of the status badge**.
`minecraft-java` → "Java", `minecraft-bedrock` → "Bedrock" (strip the
`minecraft-` prefix, capitalize). Hidden when `type` is null/unavailable.

## 5. Icon avatar

`craftyStats.icon` rendered as a ~36px **rounded-circle** `<img>`
(`data:image/png;base64,…`) immediately left of the `<h2>` server name,
vertically centered on that line, `object-fit: cover`, with a subtle border to
match the card. **Hidden entirely when `icon` is null/empty.**

## Scope / out of scope

- In scope: the five items above, in `server.js` + `public/example_index.html`.
- The live deployment's real `index.html` is separate from this template; the
  frontend snippet must be mirrored there manually (will be flagged).
- Out of scope: player names, `mem_percent`, backup info.

## Verification

Exercise `getCraftyStatus`/badge logic against the live Crafty API for a
running server, a stopped server, and (where observable) the crashed/updating
flags, before declaring done.
