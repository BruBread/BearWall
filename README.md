# BearWall

BearWall turns a cheap HY300 projector into a wall display for my room. It projects widgets like the weather, a clock and PC stats straight onto the wall. Black means no light, so the widgets look like they float on the wall instead of sitting in a glowing rectangle.

The projector side (rooting it, keystone warping, sleep mode) lives in [Hy300-Root](https://github.com/BruBread/Hy300-Root). This repo is the display system that runs on top of it.

## Status

Planning is done and the interactive prototype works. Phase 1 (the real app on the projector) is next.

## Try the prototype

Double-click [`BearWall.bat`](BearWall.bat), or open [`prototype/index.html`](prototype/index.html) in a browser. You don't need a build step or a server. Once the projector app exists, put its address in `local.json` (copy [`local.example.json`](local.example.json)) and `BearWall.bat` opens the projector's control page instead.

- **The wall:** the black 16:9 box shows exactly what the projector would show. **Fullscreen** shows it the way it looks on the wall.
- **Click a widget** to move it or drag its corners to resize it. Everything snaps to an 8 px grid on a 1280 × 720 wall. **Click empty wall** to see it clean, exactly as the projector shows it.
- **Hold Shift** on a selected section to warp it onto the wall's angle, with the same moves as the keystone page in [Hy300-Root](https://github.com/BruBread/Hy300-Root): drag a corner, drag an edge's square to stretch that side, drag inside to move it, or scroll to zoom. Shift + arrows nudge a corner 1 px (1–4 pick it), Ctrl+Z undoes, and Ctrl+R flattens it. Widgets don't warp on their own; they bend with their section.
- **Sections:** areas of the picture, one for each surface the projector reaches. The wall starts empty: drag on it to draw a section (or press **Add section**), and every widget lives in a section. Hold Shift on a section to warp it onto its surface, and its widgets bend with it. Double-click a section to go inside it and place its widgets flat; Esc or **Back to wall** returns.
- **Window mode:** the **Window** button above the wall turns your window section into a live window onto the sky outside. The sky follows the real sun, it rains, storms, clouds over or fogs with the live weather, and you pick the frame (cross, sliding, arched, round or none). That section's widgets hide while other sections keep theirs.
- **Widgets:** each family has a Style row. **Weather** has Now, Hourly, Radar (RainViewer), Storm (shows only when a cyclone is inside PAR) and Tide & sea. **Clock** has Digital, Flip, Analog, Words, Date (with day, week, month or year progress) and Sun & moon. Every widget switches by itself between a square layout and a one-row rectangle for corners, depending on how wide you stretch it, and has its own settings.
- **Adding widgets:** pick one from the gallery of live previews under Motion. **Photos** is a slideshow of pictures you upload, shrunk to 1280 px and kept in your browser, in three styles: Hologram (a Star Wars-style projected message), Glitch and Plain. The box takes the photo's proportions so nothing is cropped; Shift + resize changes the shape and crops it.
- **Alerts and Projector:** every style always shows a calm view and pulses or flashes when something happens, one thing per style so each can sit anywhere. **Projector** shows the projector's Temperature, Storage, Memory, Uptime and Power cuts. **Alerts** has Internet, Wi-Fi devices, Malware watchdog, ADB, Update and Walang Pasok.
- **Phase 2 preview:** the Devices card pretends your laptop or phone joined the Wi-Fi. Each widget has a **Show when** setting (always, laptop connected, phone connected), so you can design the wall for each case. The **PC** family (Now playing, PC stats, On Air) uses sample data until the PC agent exists, and the phone connecting shows "Welcome home".
- **Update projector:** checks this GitHub repo for new commits and offers an update.
- **Weather:** live weather from [Open-Meteo](https://open-meteo.com/) (free, no API key), with a city search. Switch to **Sample** to preview any condition or time of day.
- **Look:** the Look card (under Warp) shows only the controls the selected widget actually uses: colors with a full color picker or presets, plus ring thickness, track brightness, glow and icon colors where they apply. A Hologram photo has one color; a Plain photo has none. **Motion** (Full, Lite, Calm, Off) applies to every widget.

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
