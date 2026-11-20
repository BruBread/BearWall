# BearWall

BearWall turns a cheap HY300 projector into a wall display for my room. It projects widgets like the weather, a clock and PC stats straight onto the wall. Black means no light, so the widgets look like they float on the wall instead of sitting in a glowing rectangle.

The projector side (rooting it, keystone warping, sleep mode) lives in [ProjectorRoot](https://github.com/BruBread/ProjectorRoot). This repo is the display system that runs on top of it.

## Status

Planning is done and the interactive prototype works. Phase 1 (the real app on the projector) is next.

## Try the prototype

Open [`prototype/index.html`](prototype/index.html) in a browser. You don't need a build step or a server.

- **The wall:** the black 16:9 box shows exactly what the projector would show. **Fullscreen** shows it the way it looks on the wall.
- **Set-area mode:** drag widgets around inside their screen and drag the corners to resize them. Move a screen by dragging its pink name tag. Everything snaps to an 8 px grid on a 1280 × 720 wall. Arrow keys nudge the selection, Shift + arrows resize it, and Delete removes it.
- **Corner pins:** the projector usually doesn't hit one flat wall square-on. Select a screen, press **Warp corners**, and drag its 4 pins until it looks straight on the real wall. Each screen gets its own warp, so one screen can sit on each side of a room corner.
- **Widgets:** weather, clock, date with progress, sun and moon, and hourly forecast. Each has a square mode and a one-row rectangle mode for corners, plus its own settings.
- **Weather:** live weather from [Open-Meteo](https://open-meteo.com/) (free, no API key), with a city search. Switch to **Sample** to preview any condition or time of day.
- **Styling:** ring color and thickness, glow, icon colors, and four motion levels.

The prototype saves your layout and settings in your browser's local storage.

## How it will work

- A small Android kiosk app on the projector shows a fullscreen WebView of the wall page. The same app runs a tiny HTTP server on port 8080 that serves the wall page, a control page for your phone, and a JSON API for the layout and settings.
- You open the control page on your phone and arrange the wall in set-area mode.
- An optional PC agent pushes live data from the PC (CPU and GPU stats, now playing, mic and camera "On Air") every 2 seconds. Widgets that only need the projector keep working when the PC is off.

The full design is in [`docs/PLAN.md`](docs/PLAN.md).

## Roadmap

1. **Phase 1:** kiosk app and server, the wall runtime, the weather widget, the control page, and calibrating the corner pins on the real wall.
2. **Phase 2:** the PC agent and the first PC widgets (PC stats, now playing, On Air).
3. **Phase 3:** the rest of the standalone widgets (clock, calendar, countdown, sun and moon, and more).
4. **Phase 4:** the rest of the PC widgets.

## Private values

Anything personal (projector and PC IP addresses, home city, names) goes in `local.json`, which is gitignored. It never goes in the code.

## License

MIT. See [LICENSE](LICENSE).
