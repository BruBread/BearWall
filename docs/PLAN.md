# BearWall plan

This is the design for BearWall: what it does, the decisions behind it, and the order it gets built in.

## Architecture

- **Everything runs on the projector.** A small kiosk Android app shows a fullscreen WebView of `http://127.0.0.1:8080/wall`. The same app runs a small HTTP server on port 8080 that serves:
  - `/wall`: the wall page the projector shows
  - `/control`: the control page you open on your phone
  - `GET/PUT /api/layout` and `GET/PUT /api/settings`: stored as `layout.json` in the app's storage
  - `GET /api/events`: Server-Sent Events, so the wall updates live when you change something
- **The PC is optional.** It's used to build and push updates, and to run the PC agent for PC widgets.
- **Boot:** a `BOOT_COMPLETED` receiver starts the app. Magisk `service.d` scripts don't run on this projector.

## Layout model

- The **wall** is one 1280 × 720 surface. **Widgets** sit directly on it. You drag and resize them freely, and they snap to an 8 px grid.
- Each widget slot can hold a **priority stack**: the first widget that has something to show wins. There's also an optional rotate mode.
- Every widget has two modes:
  - **Square:** spread out.
  - **Rectangle:** one row, for corners. Its anchor (left or right) mirrors the order so it hugs the corner.
- **Shape is automatic:** a widget becomes the one-row rectangle once it's at least 2.4x wider than tall and goes back to square below 2.0x.
- **Text never overlaps** other parts of a widget. It shrinks to fit down to 50%, then gets an ellipsis.

The prototype already uses the layout shape that `layout.json` will use:

```json
{ "widgets": [ { "id": "w1", "type": "weather", "mode": "square", "anchor": "right",
                 "x": 64, "y": 120, "w": 264, "h": 264, "opts": {},
                 "quad": [[60, 110], [340, 130], [64, 390], [330, 380]] } ] }
```

Coordinates are wall pixels. `quad` is optional. It holds the widget's 4 corners on the wall, in the order top-left, top-right, bottom-left, bottom-right. When it's set, the widget's flat `w` × `h` content is warped onto those corners.

## Sections

- A **section** is an area of the projected picture, one for each surface the projector reaches. There's no built-in section: the wall starts empty, you draw sections (drag on empty wall or press Add section), and every widget lives in one. Deleting a section deletes its widgets (after a second tap).
- A section can be warped onto its surface with its 4 corners (hold Shift). Its widgets lay out flat inside it and bend with it. A widget can still have its own warp on top.
- **Double-click** a section to go inside it: the preview shows it flat and as large as fits, so you can place its widgets without the warp in the way.
- Each section has a **background**: None, or a registered background such as **Window**. The Window button above the wall turns Window mode on: window sections show the live sky and hide their widgets, while other sections keep theirs.
- Layout shape: `{ windowOn, sections: [{ id, name, x, y, w, h, quad?, bg, bgOpts }], widgets: [{ ..., section }] }`. A widget's coordinates are in its section's own flat space.

## Warping onto a real wall

The projector doesn't hit the wall square-on, so **each section gets its own 4-corner warp**, and the widgets inside a section bend with it. Widgets have no warp of their own.
- **Modes:** View (nothing selected, the clean wall), Arrange (click a widget or section to move or resize it), Warp (hold Shift with a section selected).
- **Moves while warping:** the same as Hy300-Root's keystone page: drag a corner, drag an edge's square to stretch that side, drag inside to move the section, scroll or pinch to zoom.
- **Fine control:** Shift + arrows nudge one corner by 1 px, 1–4 pick it, Ctrl+Z undoes, Ctrl+R flattens.
- **How it's drawn:** the section lays out flat at its own size, and a CSS `matrix3d` homography maps it onto its corners. The GPU does this natively, and Chrome 95 supports it.
- **Limits:** corners stay on the panel, and folded or mirrored shapes are refused.
- **No root needed:** the wall page applies the warps itself, so the hardware keystone can stay neutral. Measure the animation cost of that in Phase 1.
- **"Neutral" is not `0,0` on this projector.** The panel is kept upside down on purpose and the hardware keystone holds a 180° rotation (see [panel_flip.md](https://github.com/BruBread/Hy300-Root/blob/main/scripts/panel_flip.md)). Neutral is `lt=1280,-720 rt=-1280,-720 lb=1280,720 rb=-1280,720`. Writing `0,0` turns the whole wall upside down. Anything that writes `persist.sys.keystone.*` has to apply the 180° rule from that doc.
- **Shift on a widget** is free for widget-specific editing: on a Photos widget, Shift + resize changes the box's shape and crops the photo (normally the box keeps the photo's proportions).

## Look

- **Widgets** use JetBrains Mono, bundled locally (OFL).
- **The control page** matches my TuyaLightsControl app:
  - Nunito font and a `#150c2c` background with blurred pink (`#ff7ac6`) and blue (`#5b6cff`) blobs.
  - Glass cards (`#ffffff12` fill, `#ffffff26` border, 28 px radius).
  - Pill tabs and white gradient switches.
- **Rings** are one fixed color (default cyan `#5ee6ff`) in an Apple Activity style, starting at 12 o'clock.
- **Icons** use natural colors by default: yellow sun and bolt, pale yellow moon, white cloud, blue rain, grey-blue fog. You can switch them to all white or to the ring color. Icons use the same stroke width and round caps as the ring.
- **Motion levels:**
  - **Full**
  - **Lite:** about 8 fps, using `steps()`.
  - **Calm:** moves only when data changes.
  - **Off**

  The default gets picked by measuring on the projector, with frame drops from `dumpsys gfxinfo` and the SoC temperature. Constant animation forces SurfaceFlinger to redo the keystone warp every frame.

## Weather widget (the first widget)

- Condition icon from Open-Meteo weather codes: clear (sun, or moon at night), partly cloudy, cloudy, rain, thunder, fog.
- Temperature in °C inside a **humidity ring**.
- A greeting by time of day ("Good morning / afternoon / evening") with an optional name.
- A city picked on the control page through Open-Meteo geocoding.
- The icon, ring, greeting and city are always shown. Feels-like and high/low are optional toggles.
- Refreshes every 10 minutes.

## Widget catalogue

Widgets are grouped into families. Each family is one widget in the gallery, with styles you switch between, like Clock (Digital, Flip, Analog, Words, Date, Sun & moon) and Weather (Now, Hourly).

**Reminders** (planned family, ideas stage): notes and timers in one widget, with these styles:
- Note
- Checklist
- Focus (Pomodoro)
- Countdown
- Timer
- Stopwatch
- Scheduled reminders that appear only when they're due

**Alerts** (planned family, ideas stage): things the system notices about your tech and home. Reminders are things you set. Alerts stay invisible until something matters, then catch your attention.
- **Alert levels:** info is a quiet pulse, warning flashes once, critical flashes and, later, the bulb flashes too.
- **Styles so far:** Internet (down or slow) and Projector health (temperature, storage).

**Weather warnings** (planned additions to the Weather family, using the same attention levels):
- Rain soon
- Thunderstorm
- Dangerous heat index
- Bad air quality
- Extreme UV
- Typhoon

The list below is the original idea list. Some items are now styles of a family.

**Standalone** (they only need the projector):
- clock (digital, analog, or word clock)
- date and day progress
- weather and hourly forecast
- countdown
- today's schedule (calendar ICS)
- label or note
- sun arc and moon phase
- semester or year progress
- focus ring (Pomodoro)
- habit grid
- GitHub contributions
- earthquake alert (USGS)
- air quality
- internet status
- spotlight frame (lights up real objects on the wall)
- ambient scenes (starfield, lava, matrix)
- quote or fact
- world clock

**Dynamic** (they need the PC agent, `pc_agent.py`, which pushes every 2 s; a widget counts as offline after about 10 s without a heartbeat):
- PC stats
- now playing (Windows media session)
- On Air (mic or camera in use)
- working on (foreground app)
- coding stats
- laptop battery
- task watcher (`wall-run <cmd>`)
- game HUD

**Later (v2):** scenes, smart bulb sync (Tuya, local control), presence greeting, desk pet.

## Phases

1. **Set-area mode and weather.** The kiosk app and server (Java), the wall runtime, the design system, the weather widget, and the control page. Before building, write the shared contracts first:
   - the `layout.json` schema
   - the widget module contract: `{ name, modes, settings schema, defaults, mount(), update() }`
   - the API list

   Calibrate the warp on the real wall from a phone, and measure motion cost with the hardware keystone neutral.
2. **PC agent** and the first dynamic widgets: PC stats, now playing, On Air.
3. The rest of the standalone widgets.
4. The rest of the dynamic widgets, then the v2 extras.

## Hardware limits

- **The projector's WebView is Chrome 95.** Container queries, `:has()` and `color-mix()` aren't available. Widgets scale from a `--u` CSS variable set from their box size.
- **About 1 GB of free RAM**, 4 × Cortex-A35, Mali-G31 GPU.
- **The panel is 1024 × 600** and the UI is 1280 × 720. Keep strokes at 2 px or more and text at about 18 px or more.
- **The wall pauses while the projector's light is off** (sleep mode in Hy300-Root).
- **Building the APK needs Google's Android command-line tools** (verify the checksum first).

## Projector side (handled in Hy300-Root)

- **Sleep** turns `Lcd_en` off, then `Lcd_power` (only `Lcd_power` turns the LED off). `Lcd_en = 0` is still the signal the wall watches to hide and pause.
- **The power button** belongs to Hy300-Root's [`bearwall_power.sh`](https://github.com/BruBread/Hy300-Root/blob/main/scripts/bearwall_power.sh): short press sleeps or wakes, holding 2 s or more turns the picture 180°. The wall must not handle POWER.
- **Never put Android to sleep** (`KEYCODE_SLEEP`, `goToSleep`). Deep suspend crashes the RK628 HDMI-in driver and hard-resets the projector. A wake lock set at boot keeps it from happening.
- **The remote's window-mode button** is `KEY_MENU` (Linux code 139), which reaches the app as `KEYCODE_MENU`.
- **The remote's light button** is Linux code 187. The stock layout maps it to `F6`, which opens the HDMI viewer; BearWall's layout maps it to `F9` instead, and `F9` toggles Light mode (the volume keys set the bulb's brightness only while it's on).
- **The bulb** (Tuya, local protocol 3.5) is run by the app (`Lights.java`, `Tuya.java`): it finds the bulb at its last address or by trying port 6668 across the /24, keeps one session open, reads it every 10 s and spaces commands 0.4 s apart.

## Private values

Real IPs, the home city and names go in `local.json` (gitignored), never in code.

## Open questions

- Calendar source for the schedule widget?
- Which creative widgets make v1?
- Which tool reads CPU and GPU temperatures (for example LibreHardwareMonitor)?
