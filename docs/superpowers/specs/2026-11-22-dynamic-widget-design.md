# BearWall: Dynamic widget + Debrief (bridge to Phase 3) — design

Status: approved approach A (2026-11-22). Goes into `BearWall/docs/superpowers/specs/` after Greenlight.

## Why
Section 1 is the main screen, but on the real wall it is about two-thirds black (a flip clock top-right, one photo bottom-right).
The user wants it never blank and always showing the most relevant thing, with BearWall's voice saying the important parts.
This is also the bridge to Phase 3: laptop, phone and reminders later become more sources for the same system.

## Goals
- A **Dynamic** widget: shows one big "card" at a time, picked by simple, predictable rules.
- Several Dynamic widgets allowed. One is **Main** (meant for section 1); the others are **Secondary** with chosen sources.
- A **debrief**: a short spoken run-through where each line's card pops up on Main in sync.
- Never blank, online or offline, day or night.

## Non-goals (this round)
- New voice lines (light scene lines, temperature tiers): recorded later. Cards only use the 141 clips that exist.
- Phase 3 sources (laptop, phone, presence, reminders). The card feed is built so they plug in later.
- Reusing the existing widgets' visuals inside the Dynamic widget (approach B, rejected).

## Anti-goals (failure even if it "works")
- A chatty wall: voice only from Main, only for urgent cards and the debrief, never in quiet hours, existing 5-min cooldown.
- The same card flashing up again and again, or the same card on two widgets at once.
- Jank: only transform/opacity animations (the projector GPU is weak); no rAF loops; one 1 s tick shared with the wall.
- A blank or "No data" box.

## Approaches considered
- **A. Card feed + Dynamic widget (picked).** Sources post small cards to a shared feed (`BearWall.card`). `widgets/dynamic.js`
  is a normal widget that picks from the feed and draws cards in one style. The debrief is an ordered list of cards plus voice lines.
  Trade-off: cards don't look like the existing widgets; in exchange they're light, consistent, and can say things no widget does
  ("rain in 40 min", "internet dropped twice").
- B. Dynamic widget that mounts the existing widgets and swaps them. Rejected: heavy swaps, fixed-size widgets, still needs cards for
  facts that aren't widgets.
- C. Overlay on section 1 like the Light mode panel. Rejected: the user wants it as a widget, several of them, with settings.

## Cards
`BearWall.card({ id, source, tier, icon, title, detail, say, key, until })` adds or replaces a card by `id`; `BearWall.uncard(id)` removes it.
- `source`: `weather` | `alerts` | `time` | `photos` | `lights` (later `laptop`, `phone`, `reminders`).
- `tier`:
  - `urgent`: interrupts at once, stays pinned in Main's strip until removed. Voice on Main.
  - `heads`: pops once when it becomes true (and again only if its `key` changes), then lives in the strip until `until`.
  - `ambient`: the idle rotation.
- `say`: optional voice line ids (only Main speaks them, only for urgent cards and in the debrief).
- `key`: what counts as "changed" (e.g. rain 40 min -> 10 min away).
- `until`: expiry Date (heads-up cards), or none.

### Built-in producers (wall.js, every tick)
- Alerts: each active alert -> urgent card for `critical` (internet down, storm, malware, chip >= limit+8), `heads` for warning/info.
  Walang Pasok and storm widgets post their own cards.
- Weather heads-up: rain within 60 min (or stopping), feels-like >= 38 °C between 11:00-16:00, sunset within 15 min, update available.
- Ambient by time of day:
  - morning (05-11): today's forecast + rain chance, classes on/off.
  - afternoon (11-18): next 3 hours, feels-like, sunset time.
  - evening (18-23:30): tomorrow's weather, moon phase, a photo.
  - night (quiet hours): only a dim clock card; nothing rotates.
- Default card **Now & Next** (Main): now = icon + temp + feels; next = first of: rain/rain stopping within 3 h, sunset/sunrise within 2 h,
  tomorrow's weather after 18:00, else a 3-point mini timeline of the next hours.
- Offline (no live weather): Now & Next becomes date + day progress + "Weather offline" (never the sample data).

## The Dynamic widget (`widgets/dynamic.js`)
Options:
- `role`: tabs Main / Secondary (default Main for the first one placed, Secondary after).
- Sources: switches Weather, Alerts, Day & time, Photos, Lights (all on for Main).
- Secondary only: tiers Heads-up / Ambient switches.
- `hold`: how long a popped card stays big: 6 / 8 / 12 s (default 8).
- `rotate`: ambient change every 30 / 60 / 120 s (default 60).

Layout: the big card area; on Main in square mode, a strip of up to 3 compact chips along the bottom (pinned urgent first, then the
newest heads-up within 2 h). Rect mode = the card only, one row.

Picking (every 1 s, per widget):
1. Candidates = feed cards from its sources (Main also gets every urgent card). Secondary skips cards Main is showing now.
2. A higher tier interrupts a lower one. A new urgent shows at once; a new heads-up shows when nothing urgent is up.
3. A popped card holds `hold` s, then the widget returns to the rotation.
4. Ambient rotation: next ambient card every `rotate` s, least recently shown first, then back to the default card.
5. Nothing to show -> the default card: Now & Next (Main); per-source default for Secondary (Alerts "All clear", Photos a photo,
   Weather Now & Next, Day & time the date + day progress).

Motion: pop = scale .92 -> 1 + fade; back = slide down into the strip + fade. Calm = crossfade; Off = instant.

## Debrief
`BearWall.debrief(reason)`: builds a short playlist and plays it on Main, each step = show card + say its lines, waiting for the line to end.
1. Greeting (`boot`/`wake`/`update-done` + `greet-*`), plus the day's line once a day (as hello() does today; hello() is replaced).
2. Time: hour line (`hour-N`).
3. Temperature: `temp-20` … `temp-40` when 20-40 °C (otherwise card only).
4. Rain today: `brief-rain` / `brief-no-rain`.
5. Classes: `brief-classes-on`, or `pasok`.
6. Anything that happened while asleep: urgent/heads cards posted between sleep and wake, newest first, max 3.
Then Main settles to Now & Next.

Triggers: startup and wake (automatic), and a short **OK** press on the remote outside Light mode (WallActivity calls
`BearWall.debrief('button')`; OK does nothing on the wall today). Quiet hours: the debrief shows cards but stays silent.
Needs `BearWallSound.say()` to return a Promise that resolves when its lines have played (or at once if skipped).

## Files
- `prototype/wall.js`: card feed + built-in producers, debrief (replaces hello()), sleep event log.
- `prototype/widgets/dynamic.js` (new) + `index.html` script tag.
- `prototype/sound.js`: `say()` returns a Promise.
- `prototype/widgets/alerts-pasok.js`, `weather-storm.js`: post their cards.
- `android/.../WallActivity.java`: OK -> debrief outside Light mode.

## Testing
Headless (cdp.js): tier interrupt order; heads-up pops once per key; rotation; never blank (online, offline, night); Secondary filters
and no duplicate with Main; debrief order with a stubbed voice; no exceptions. On device: fps check while cards animate, then the user
watches a debrief.

## Calls made by Claude (user may override)
- OK button for the debrief; automatic at startup and wake.
- Thresholds: rain within 60 min, feels-like >= 38 °C 11-16 h, sunset within 15 min, strip keeps heads-up for 2 h.
- After install, Claude adds a Main Dynamic widget to the empty left/middle of section 1; the user can move or resize it.
- Offline Now & Next shows date + day progress (no offline sunrise math).
- Photos source = the photos already chosen in the wall's Photos widgets (no new photo picker).
- Lights source: a heads-up card when the scene changes, and the current scene as an ambient card while the bulb is on.
- Classes (debrief step 5 and the morning card) only when a Walang Pasok widget has keywords set; otherwise skipped.
- Moon phase computed from the date (no extra feed).
