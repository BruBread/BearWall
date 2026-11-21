# BearWall

BearWall turns a cheap HY300 projector into a wall display for my room. It projects widgets like the weather, a clock and PC stats straight onto the wall. Black means no light, so the widgets look like they float on the wall instead of sitting in a glowing rectangle.

The projector side (rooting it, keystone warping, sleep mode) lives in [ProjectorRoot](https://github.com/BruBread/ProjectorRoot). This repo is the display system that runs on top of it.

## Status

Planning is done and the interactive prototype works. Phase 1 (the real app on the projector) is next.

## Try the prototype

Double-click [`BearWall.bat`](BearWall.bat), or open [`prototype/index.html`](prototype/index.html) in a browser. You don't need a build step or a server. Once the projector app exists, put its address in `local.json` (copy [`local.example.json`](local.example.json)) and `BearWall.bat` opens the projector's control page instead.

- **The wall:** the black 16:9 box shows exactly what the projector would show. **Fullscreen** shows it the way it looks on the wall.
- **Click a widget** to move it or drag its corners to resize it. Everything snaps to an 8 px grid on a 1280 × 720 wall. **Click empty wall** to see it clean, exactly as the projector shows it.
- **Hold Shift** to warp the selected widget to the wall's angle. Each widget has its own 4 corners, and it uses the same moves as the keystone page in [ProjectorRoot](https://github.com/BruBread/ProjectorRoot):
  - Drag a corner, drag an edge's square to stretch that side, or drag inside to move it. Scroll or pinch to zoom.
  - Nudge a corner 1 px with Shift + arrows, and pick it with 1–4.
  - Undo with Ctrl+Z, and flatten the widget back to a plain rectangle with Ctrl+R.
- **Sections:** areas of the picture, one for each surface the projector reaches. The wall starts empty: drag on it to draw a section (or press **Add section**), and every widget lives in a section. Hold Shift on a section to warp it onto its surface, and its widgets bend with it. Double-click a section to go inside it and place its widgets flat; Esc or **Back to wall** returns.
- **Window mode:** the **Window** button above the wall turns your window section into a live window onto the sky outside. The sky follows the real sun, it rains, storms, clouds over or fogs with the live weather, and you pick the frame (cross, sliding, arched, round or none). That section's widgets hide while other sections keep theirs.
- **Widgets:** each family has a Style row. **Weather** has Now, Hourly, Radar (RainViewer), Storm (shows only when a cyclone is inside PAR) and Tide & sea. **Clock** has Digital, Flip, Analog, Words, Date (with day, week, month or year progress) and Sun & moon. Every widget switches by itself between a square layout and a one-row rectangle for corners, depending on how wide you stretch it, and has its own settings.
- **Adding widgets:** pick one from the gallery of live previews under Motion. **Photos** is a slideshow of pictures you upload, shrunk to 1280 px and kept in your browser, in five styles: Hologram (a Star Wars-style projected message), Neon lines, LED dots, Glitch and Plain.
- **Alerts:** invisible until something matters, then they pulse or flash. Network checks the real internet connection, with ping every 10 minutes and a quick speed test every hour (about 96 MB a day). **Walang Pasok** watches news headlines for class suspensions that mention names you type in (kept in your browser, never in the code). Projector (temperature, storage, power cuts), Security (the proxy malware coming back, new ADB connections) and Update available use sample alerts you can fire from the Devices card until the projector app exists.
- **Phase 2 preview:** the Devices card pretends your laptop or phone joined the Wi-Fi. Each widget has a **Show when** setting (always, laptop connected, phone connected), so you can design the wall for each case. The **PC** family (Now playing, PC stats, On Air) uses sample data until the PC agent exists, and the phone connecting shows "Welcome home".
- **Update projector:** checks this GitHub repo for new commits and offers an update.
- **Weather:** live weather from [Open-Meteo](https://open-meteo.com/) (free, no API key), with a city search. Switch to **Sample** to preview any condition or time of day.
- **Look:** the Look card (under Warp) sets the selected widget's own ring, text and secondary text colors with a full color picker or presets, plus ring thickness, track brightness, glow and icon colors (natural, white, ring color or any custom color). **Motion** (Full, Lite, Calm, Off) applies to every widget.

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
