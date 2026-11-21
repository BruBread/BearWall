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
- **Text never overlaps** other parts of a widget. It shrinks to fit down to 50%, then gets an ellipsis.

The prototype already uses the layout shape that `layout.json` will use:

```json
{ "widgets": [ { "id": "w1", "type": "weather", "mode": "square", "anchor": "right",
                 "x": 64, "y": 120, "w": 264, "h": 264, "opts": {},
                 "quad": [[60, 110], [340, 130], [64, 390], [330, 380]] } ] }
```

Coordinates are wall pixels. `quad` is optional. It holds the widget's 4 corners on the wall, in the order top-left, top-right, bottom-left, bottom-right. When it's set, the widget's flat `w` × `h` content is warped onto those corners.

## Warping onto a real wall

The projector doesn't hit the wall square-on, so **each widget gets its own 4-corner warp**.
- **Modes:**
  - **View:** nothing selected, the clean wall.
  - **Arrange:** click a widget to move it or resize it.
  - **Warp:** hold Shift, or turn on the "Warp handles" switch on a phone.
- **Moves while warping:** the same as ProjectorRoot's keystone page:
  - Drag a corner.
  - Drag an edge's square to stretch that side.
  - Drag inside to move the widget.
  - Scroll or pinch to zoom.
- **Fine control:** nudge one corner by 1 or 10 px with Shift + arrows or a D-pad. There's also Undo and Flatten.
- **Arrange on a warped widget** moves its whole shape on the 8 px grid.
- **How it's drawn:** the widget lays out flat at its own size, and a CSS `matrix3d` homography maps it onto its corners. The GPU does this natively, and Chrome 95 supports it. Widgets don't know they're warped.
- **Limits:** corners stay on the wall, and folded or mirrored shapes are refused.
- **No root needed:** the wall page applies the warps itself, so the hardware keystone can stay neutral. That may also make animation cheaper, because SurfaceFlinger then has no keystone pass to redo every frame. Measure this in Phase 1.

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
- **The wall pauses while the projector's light is off** (sleep mode in ProjectorRoot).
- **Building the APK needs Google's Android command-line tools** (verify the checksum first).

## Private values

Real IPs, the home city and names go in `local.json` (gitignored), never in code.

## Open questions

- Calendar source for the schedule widget?
- Which creative widgets make v1?
- Which tool reads CPU and GPU temperatures (for example LibreHardwareMonitor)?
