# Dynamic widget + Debrief Implementation Plan

> Native execution (lead builds inline; user said Greenlight). Spec: 2026-11-22-dynamic-widget-design.md (same folder).

**Goal:** a card feed in the wall, a Dynamic widget (Main/Secondary) that shows the most relevant card, and a spoken debrief.
**Architecture:** wall.js owns the feed (`BearWall.card/uncard/cards`) and built-in producers run on the existing 1 s tick; widgets/dynamic.js
picks and draws; sound.js `say()` returns a Promise so the debrief can step in sync.
**Tech:** plain ES2020 for Chrome 95, Web Audio, Java (WallActivity). Tests: headless Edge via scratchpad cdp.js.

## Global Constraints
- Chrome 95: no `:has`, container queries, `color-mix`; only transform/opacity animations; no rAF loops.
- Widget contract (wall.js header): scope CSS under `.w-dynamic`, size with `calc(var(--u) * n)`, `fit` + `util.fit(el)`, no page class names.
- Never blank. Voice: only Main, only urgent + debrief, never in quiet hours (anyTime only for the debrief button? no: debrief stays silent in quiet hours).
- No private values in code (public repo).

## Review Focus
1. Offline (no live weather): Now & Next must not show sample data -> date + day progress. Test: offline card.
2. Two Main widgets placed: only the first by layout order acts as Main (voice, all urgent); others behave as Secondary. Test.
3. Card removed while showing (alert cleared): widget falls back within 1 s, no stale card. Test.
4. Night/quiet hours: rotation stops, dim clock card. Test with quiet window.
5. Debrief pressed while a debrief runs: ignored (no double voice). Test.

### Task 1: say() returns a Promise (sound.js)
- `say(ids, opts) -> Promise<void>` resolves when its queue item finished playing, or at once when skipped (silent, cooldown, quiet).
- Test (test_dynamic.js): `await BearWallSound.say('boot', {force:true})` resolves after the stubbed clip length; skipped say resolves < 50 ms.

### Task 2: card feed + producers (wall.js)
- `BearWall.card(c)`, `BearWall.uncard(id)`, `BearWall.cards() -> [card]` (fresh array; expired `until` dropped).
- Card: `{ id, source, tier: 'urgent'|'heads'|'ambient', icon, title, detail, say?: string[], key?, until?: Date, at: ms }`.
- Producers in `cardTick(now, weather)` called from the 1 s interval (before the `due` early return): alerts -> cards (critical=urgent, else heads,
  id 'alert-'+id); weather heads (rain-soon/rain-stop within 60 min from hourly pop >= 50 and cond rain/thunder, hot feels>=38 11-16h,
  sunset within 15 min); ambient by daypart (morning/afternoon/evening/night per spec) incl. lights scene, photo, moon; `nowNext` default.
- Sleep log: cards posted (urgent/heads) while `sleeping` are remembered for the debrief (max 3, newest first).
- Tests: alert -> urgent card and removed on clear; offline nowNext = date card; night = clock card only.

### Task 3: widgets/dynamic.js
- Options: role tabs main/secondary; switches src_weather, src_alerts, src_time, src_photos, src_lights (default true); sec_heads, sec_ambient
  (default true); hold select 6/8/12 (default '8'); rotate select 30/60/120 (default '60'). every: 1000.
- Main = first widget of type dynamic with role main in layout order (`BearWall.isMainDynamic(w.id)` from wall.js).
- Picking per spec (tiers, hold, rotation least-recently-shown, Secondary skips Main's current card id via a shared `showing` map).
- Strip (Main, square): up to 3 chips: pinned urgent, then heads within 2 h.
- Debrief display hook: `BearWall.spotlight(card|null)` forces Main to show a card (null = release).
- Tests: urgent interrupts ambient; heads pops once per key; secondary filters + no duplicate; card removed -> fallback; two mains -> one acts.

### Task 4: debrief (wall.js) + OK key (WallActivity)
- `BearWall.debrief(reason)` -> Promise; replaces hello(); steps per spec; ignored while running; quiet hours: cards without voice.
- WallActivity: DPAD_CENTER/ENTER down (no repeat) outside Light mode -> `BearWall.debrief('button')`.
- Tests: step order with stub voice (greeting, hour, temp, rain, [classes], slept cards); second call while running returns at once.

### Task 5: ship
- Run test_dynamic.js, test_voice.js, test_sound.js; build APK; install; add a Main Dynamic to section 1's empty area (layout via PUT kv);
  fps check (test_frames-style) during a card pop; user watches a debrief; commit; memory.
