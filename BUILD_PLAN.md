# Task Slayer — Improvements (Session-Paced)

## Context
The user wants to upgrade Task Slayer (oakhem.com) with the **Quick Wins + Medium Projects** scope from the prior brainstorm — skipping all "Big Stuff". Critically, they want this paced **across multiple Claude Code sessions** (1–2 batches per session, ~1 hour gap between sessions) so we never overflow the context window. We also need a clean **rollback path** in case anything breaks the live site.

This plan is the persistent checklist that survives between sessions. Future sessions read it, see what's done vs pending, do the next 1–2 batches, commit, update this file, and stop.

---

## Project quick-orient (for any future session)

- **Live URL:** https://oakhem.com (custom domain on GitHub Pages)
- **Repo:** https://github.com/oak8513/Task-Slayer
- **Local path:** `C:\Users\Owner\Documents\Claude\Projects\TaskSlayer`
- **Stack:** Static HTML + Babel-standalone JSX (React 18 from CDN). No build step. PWA with service worker. Supabase backend for cross-device sync via `sync.js`.
- **Auth:** Supabase magic-link email. State is per-user in `public.user_state` (jsonb blob keyed by `taskslayer/*` localStorage keys), RLS scoped to `auth.uid()`.
- **Sync:** Realtime via Supabase channel. Cyberdog state and one-shot flags excluded from sync (per-device).
- **Signup notifications:** Postgres trigger on `auth.users` INSERT → pg_net → Zapier webhook → email to help@yorkcomputerrepair.com.
- **Service worker** caches aggressively — bump `CACHE` version in [sw.js:2](sw.js:2) on every batch so users pick up changes.

---

## Rollback strategy (set up once at start of Batch 0)

1. **Tag stable baseline** — `git tag v1-stable && git push --tags` before any feature work. Worst-case escape hatch: `git reset --hard v1-stable && git push --force-with-lease`.
2. **One commit per feature** — small atomic commits, easy to `git revert <sha>` any single one.
3. **Feature flags in Tweaks** — risky features gated by a `flags` object in `tweaks` (already cloud-synced). User can toggle off live without a redeploy. Defaults documented per batch below.
4. **SW cache bump** — every batch increments `CACHE` so old clients refresh.

---

## Session protocol

Every session that picks this up should:
1. Read this file from top to bottom.
2. Find the first ☐ unchecked batch under "Build batches" — that's the work for this session.
3. Do **1 or 2 batches max**, depending on size. Stop before context gets tight.
4. After each batch's commit + push: tick the ☐ to ☑, append a one-line note ("done 2026-04-23, sha abc123, notes: ..."), update "Last touched" at the bottom.
5. Commit this plan file edit too if useful (it lives in `.claude/plans` which is gitignored, so no, just save it locally).
6. **Final action of every session:** call ExitPlanMode-equivalent and tell the user: "Batch X done. Next session: Batch X+1." Don't try to continue past the agreed batches.

If something breaks during a batch: revert that batch's commits and tick the batch as ☐ with a "BLOCKED — see notes" annotation. Move on or stop, don't skip silently.

---

## Build batches

### ☑ Batch 0 — Setup & rollback anchor (~10 min) — done 2026-04-23, sha e87d600
- `git tag v1-stable && git push --tags`
- Add `flags: {}` object to `TWEAK_DEFAULTS` in [app.jsx:108](app.jsx:108).
- Add a "Flags" section to the Tweaks panel UI (the existing `editMode` panel) — start empty; each later batch adds its own flag toggle here.
- Save a memory file pointing future sessions at this plan (path below in "Memory note").

### ☑ Batch 1 — Audio + haptics + confetti (~30 min, no flags) — done 2026-04-23, sha 4bfbc1e
- Replace stubbed `playSfx()` ([app.jsx:1082](app.jsx:1082)) with WebAudio synth: `kill`, `boss`, `levelup`, `unlock`, `death`. Pure oscillators; no audio files; respects existing `tweaks.sfxOn`.
- Add `navigator.vibrate(...)` calls alongside each sfx (15ms tap, 50/30/80 boss, longer for level up).
- Pull in `canvas-confetti` from CDN; trigger on boss kills + level ups.

### ☑ Batch 2 — PWA polish (~30 min, no flags) — done 2026-04-24, sha 41e3d74
- App badge: `useEffect` calls `navigator.setAppBadge(overdueCount)` / `clearAppBadge()`.
- `beforeinstallprompt` capture → small "📲 INSTALL" chip in screen header. Hide once installed/dismissed.
- Edit [manifest.webmanifest](manifest.webmanifest) — add `shortcuts` array (Add task / Today / Bosses).
- Add `overscroll-behavior: none` on body in [index.html](index.html) CSS.
- Dynamic `theme-color` meta — amber when in vacation mode.

### ☑ Batch 3 — Keyboard + search + date chips (~45 min, no flags) — done 2026-04-24
- Global keydown listener: `n` focus add-task, `1`–`5` switch tabs, `/` focus search, `Escape` close modal. Ignore when target is input/textarea.
- Search input above tabs row — case-insensitive title `includes`. Persists across tab switches.
- Quick-date chips (Today / Tomorrow / Next week) next to date picker.

### ◐ Batch 4 — Subtasks + tags + streaks + achievements + pet evolution (~2 hr, ALL gated by flags, default ON)
**SPLIT:** subtasks + tags done session 4. Streaks + achievements + pet evolution still ☐ (do next session as Batch 4B).
- ☑ Subtasks: `children: [{id,title,done}]` on task model. Nested checkbox UI under parent — done 2026-04-24.
- ☑ Tags: optional `tag: string` + color picker in edit modal. Filter chip strip below tabs. Color map in `tweaks.tagColors` — done 2026-04-24.
- ☐ Streak counter: new `taskslayer/streak/v1` `{current, best, lastKillDate}`. Render in HUD.
- ☐ Achievements: `taskslayer/achievements/v1` array with ~12 milestones. Toast on unlock. Modal/tab to view.
- ☐ Pet evolution: [cyberdog.jsx](cyberdog.jsx) swaps Rex sprite by level bracket (1–4 / 5–9 / 10+).
- Flags: `flags.subtasks`, `flags.tags` registered (default ON). Remaining `flags.streaks`, `flags.achievements`, `flags.petEvolution` next session.

### ☐ Batch 5 — Browser notifications (~1.5 hr, gated, default OFF)
- On signed-in render: small "ENABLE ALERTS?" nag → `Notification.requestPermission()`.
- `setInterval(checkDue, 60_000)` fires `new Notification('Task overdue: ' + title, { icon: 'faces/critical.png' })` on task due-time crossings.
- Notification click → `window.focus()`.
- No SW push / VAPID — that's "Big Stuff" we're skipping.
- Flag: `flags.notifications` default OFF (intrusive permission prompt).

### ☐ Batch 6 — Mobile UX (~2 hr, gated, mostly default OFF)
- Swipe actions: pointer events on `.task` rows. Left ≥ 80px → delete + undo toast. Right ≥ 80px → toggle done. Spring-back animation. Flag: `flags.swipeActions` default OFF.
- Long-press (600ms) on regular task → "Convert to boss" modal with HP picker. Flag: `flags.longPressBoss` default ON (low risk).
- Bottom-tab nav on `< 600px`: render existing tabs as fixed bottom bar. Flag: `flags.bottomNav` default OFF.
- Voice input: mic button next to add-bar using `webkitSpeechRecognition` + rough natural-date parse. Flag: `flags.voiceInput` default OFF (Chrome/Safari only).
- Possible split point: swipe + long-press one session, bottom nav + voice next.

### ☐ Batch 7 — Themes (~45 min, gated, default ON)
- Three themes selectable in Tweaks: `green` (default), `amber`, `red`. CSS variable swap via `data-theme` on `<html>`.
- Persist as `tweaks.theme`.
- Flag: `flags.altTheme` default ON.

---

## Verification (run after EVERY batch before committing)

1. Wait 30–60s for GitHub Pages rebuild after push.
2. Use Claude in Chrome MCP — navigate to https://oakhem.com with a cache-bust query string.
3. `read_console_messages` — pattern `error|warn|fail|exception`. Must be clean.
4. Screenshot the affected UI; compare to expected.
5. For sync-touching batches (4, 5): drive a state change, then `execute_sql` against `public.user_state` to verify the new keys round-tripped.
6. If any check fails: `git revert <sha> && git push`, mark batch as BLOCKED in this file.

---

## Critical files (single source of truth so we don't hunt every session)

| File | Role |
|---|---|
| [app.jsx](app.jsx) | Main React app — every batch touches it |
| [cyberdog.jsx](cyberdog.jsx) | Pet — Batch 4 (evolution) |
| [index.html](index.html) | CSS, theme-color meta, scripts list — Batches 1, 2, 7 |
| [manifest.webmanifest](manifest.webmanifest) | Batch 2 (shortcuts) |
| [sw.js](sw.js) | Bump CACHE version every batch |
| [sync.js](sync.js) | No changes — `taskslayer/*` prefix already covers all new keys |

---

## Memory note (Batch 0 also writes this)

So a fresh session can find this plan and the project, the first session (Batch 0) should also save:

1. A **project memory** pointing at this repo (path, live URL, stack summary, this plan file path) so any future Claude Code session in this directory orients fast.
2. A **reference memory** with the Supabase project ID (`qpxldkddhactqajlsyuk`) and Zapier webhook URL.

Memory directory: `C:\Users\Owner\.claude\projects\C--Users-Owner-Documents-Claude-Projects-TaskSlayer\memory\`

---

## Progress log

(Each session appends a line here when ticking a batch.)

- **2026-04-23 session 1:** Batches 0 + 1 complete. Rollback tag `v1-stable` pushed. Flag registry in place (empty, ready for later batches). Real WebAudio sfx + haptics + canvas-confetti wired into playSfx. Callsites updated for levelup/unlock/death kinds. Verified: console clean, all CDN scripts load, login flow intact. Next session: Batch 2 (PWA polish — app badge, install prompt, manifest shortcuts).
- **2026-04-24 session 2:** Batch 2 complete. App badge shows overdue count, beforeinstallprompt captured with INSTALL chip in header, manifest shortcuts added, overscroll-behavior:none, dynamic amber theme-color during vacation. SW cache v14. Next session: Batch 3 (keyboard + search + date chips).
- **2026-04-24 session 3:** Batch 3 complete. Global keyboard shortcuts (n / 1–5 / / / Esc) ignore input fields. Persistent search input above tabs filters task titles. Quick-date chips (TODAY/TOMORROW/NEXT WEEK) added next to DUE field in edit modal. SW cache v15. Next session: Batch 4 (subtasks + tags + streaks + achievements + pet evolution — flag-gated, possible split point).
- **2026-04-24 session 4:** Batch 4A (subtasks + tags) complete — used the planned split point. Subtasks: inline expand/collapse with nested checkboxes, add-step input, STEPS n/m counter chip; flag `subtasks` default ON. Tags: lowercase single tag per task, 8-color palette with per-tag color map in `tweaks.tagColors`, filter strip below tabs with ALL/tag chips, datalist suggestions from existing tags; flag `tags` default ON. Flags now visible in Tweaks panel. SW cache v16, app.jsx?v=8. Next session: Batch 4B (streaks + achievements + pet evolution).

---

## What we are NOT doing
Big-stuff items deferred: shared lists, co-op bosses, public profiles/leaderboards, AI task triage, AI pet dialogue, stats heatmap dashboards, weekly recap emails, animated marine face, boss combat animation, dog walking across the screen.

---

**Last touched:** 2026-04-24 — batch 4A (subtasks + tags) done; batch 4 split. Next up: Batch 4B (streaks + achievements + pet evolution — flag-gated).
