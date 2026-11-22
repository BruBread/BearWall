package com.bearwall;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.security.MessageDigest;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * BearWall's web server on port 8080 (plain Java sockets, no libraries). One request per connection.
 *   GET  /wall, /control       the page (the projector shows /wall; your laptop opens /control)
 *   GET/PUT /api/kv/{key}      saved state: layout, settings, devices, installed (JSON files)
 *   GET  /api/events           Server-Sent Events: "kv:{key}:{client}" after a save, "updating:{stage}" during an update, "reload" after it
 *   GET  /api/lights           the bulb: light, scenes, schedules, status (POST .../light, scene, scene/save, settings, setup, laptop)
 *   GET  /api/sound            ElevenLabs: {hasKey, files} (PUT .../key, GET .../credits, POST .../generate, DELETE .../file/{name},
 *                              POST .../play = "sound:play:{id}:{variant}" to the wall); GET /api/sounds/{name} serves a saved take
 *   GET  /api/system           the projector's stats (Health.java)
 *   GET  /api/proxy?url=       fetches news / storm feeds and the GitHub commit feed for the page (only the hosts listed in PROXY_HOSTS)
 *   PUT/GET/DELETE /api/photos/{id}   uploaded photos
 *   POST /api/update           downloads the newest web files from GitHub and swaps them in
 *   POST /api/live             passes the control page's live state (selected section) to the wall; not saved
 *   POST /api/hello, /api/bye  the BearWall Control panel on your laptop unlocks / locks control (see below)
 *   GET  /anything-else        static web files (from the app's copy of prototype/)
 *
 * Lock: the wall itself (127.0.0.1) can always reach everything. Anything else on the network is refused unless the
 * BearWall Control panel is open: it sends /api/hello with the paired key every 5 s, which unlocks that one laptop
 * for 15 s. Close the panel and control locks again within 15 s (open control pages are cut off).
 */
class Server {
    static final int PORT = 8080;
    static final String TAG = "BearWall";
    static final String REPO_ZIP = "https://codeload.github.com/BruBread/BearWall/zip/refs/heads/main";
    static final String[] PROXY_HOSTS = { "newsinfo.inquirer.net", "www.rappler.com", "www.gdacs.org", "github.com" };   // github.com: the commit feed for update checks
    static final Pattern KEY = Pattern.compile("[a-z]{1,20}"), PHOTO = Pattern.compile("[a-z0-9]{1,40}");

    final Context c;
    final File web, kv, photos;
    final Map<OutputStream, String> listeners = new ConcurrentHashMap<>();   // event stream -> client address
    volatile String okIp = null;     // the paired laptop that's allowed in right now
    volatile long okUntil = 0;
    final ExecutorService pool = Executors.newCachedThreadPool();
    final Lights lights;
    final Sound sound;

    Server(Context c) {
        this.c = c;
        web = new File(c.getFilesDir(), "web");
        kv = new File(c.getFilesDir(), "kv");
        photos = new File(c.getFilesDir(), "photos");
        kv.mkdirs();
        photos.mkdirs();
        lights = new Lights(c.getFilesDir(), this);
        sound = new Sound(c.getFilesDir());
    }

    void start() {
        new Thread(new Runnable() { public void run() {
            installBundledWeb();
            try (ServerSocket ss = new ServerSocket()) {
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(PORT));
                while (true) pool.execute(new Conn(ss.accept()));
            } catch (IOException e) { Log.e(TAG, "server stopped", e); }
        }}, "server").start();
        new Thread(new Runnable() { public void run() {   // keeps event streams open; cuts off a laptop whose panel closed
            for (int n = 0; ; n++) {
                try { Thread.sleep(5000); } catch (InterruptedException e) { return; }
                if (okIp != null && System.currentTimeMillis() > okUntil) lock();
                if (n % 5 == 0) send(": ping\n\n");
            }
        }}, "sse-ping").start();
    }

    /* ---------- the web files: the APK carries a copy; a newer APK replaces it, "Update projector" too ---------- */
    void installBundledWeb() {
        try {
            // every install (even with the same version number) brings fresh web files: key them to the install time
            String vc = String.valueOf(c.getPackageManager().getPackageInfo(c.getPackageName(), 0).lastUpdateTime);
            File mark = new File(c.getFilesDir(), "apk.version");
            if (web.isDirectory() && vc.equals(Files.read(mark, "").trim())) return;
            File tmp = new File(c.getFilesDir(), "web.new");
            Files.deleteTree(tmp);
            copyAssets(c.getAssets(), "web", tmp);
            swapIn(tmp);
            Files.write(mark, vc);
        } catch (Exception e) { Log.e(TAG, "could not install the web files", e); }
    }

    void copyAssets(AssetManager am, String path, File to) throws IOException {
        String[] kids = am.list(path);
        if (kids == null || kids.length == 0) {
            to.getParentFile().mkdirs();
            try (InputStream in = am.open(path); OutputStream out = new FileOutputStream(to)) { Files.copy(in, out); }
            return;
        }
        to.mkdirs();
        for (String k : kids) copyAssets(am, path + "/" + k, new File(to, k));
    }

    synchronized void swapIn(File fresh) throws IOException {
        File old = new File(c.getFilesDir(), "web.old");
        Files.deleteTree(old);
        if (web.exists() && !web.renameTo(old)) throw new IOException("could not move the old web files");
        if (!fresh.renameTo(web)) { old.renameTo(web); throw new IOException("could not move the new web files"); }
        Files.deleteTree(old);
    }

    /* ---------- requests ---------- */
    // a named class, not a nested anonymous one: d8 trips over anonymous classes inside anonymous classes
    class Conn implements Runnable {
        final Socket s;
        Conn(Socket s) { this.s = s; }
        public void run() { handle(s); }
    }

    void handle(Socket s) {
        boolean keep = false;
        try {
            s.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            String line = readLine(in);
            if (line == null || line.isEmpty()) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;
            String method = parts[0], target = parts[1];
            Map<String, String> h = new HashMap<>();
            for (String l; (l = readLine(in)) != null && !l.isEmpty(); ) {
                int i = l.indexOf(':');
                if (i > 0) h.put(l.substring(0, i).trim().toLowerCase(Locale.ROOT), l.substring(i + 1).trim());
            }
            int len = h.containsKey("content-length") ? Integer.parseInt(h.get("content-length")) : 0;
            if (len > 25 * 1024 * 1024) { reply(out, 413, "text/plain", "too large"); return; }
            byte[] body = new byte[len];
            for (int got = 0; got < len; ) { int n = in.read(body, got, len - got); if (n < 0) break; got += n; }
            String path = target, query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
            keep = route(method, URLDecoder.decode(path, "UTF-8"), query, h, body, s, out);
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        } finally {
            if (!keep) try { s.close(); } catch (IOException ignored) { }
        }
    }

    static final String LOCKED = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
        + "<body style='background:#150c2c;color:#f6f1ff;font:18px system-ui;display:grid;place-items:center;height:100vh;margin:0'>"
        + "<div style='max-width:30em;text-align:center'><h2>BearWall is locked</h2><p>Open <b>BearWall Control</b> (BearWall.bat) on your laptop. "
        + "Control stays open only while that window is.</p></div>";

    boolean keyOk(String k) {
        String want = Files.read(new File(c.getFilesDir(), "pair.key"), "").trim();
        return k != null && !want.isEmpty() && MessageDigest.isEqual(want.getBytes(StandardCharsets.UTF_8), k.trim().getBytes(StandardCharsets.UTF_8));
    }

    synchronized void lock() {
        okIp = null; okUntil = 0;
        for (Map.Entry<OutputStream, String> e : listeners.entrySet())   // cut off the laptop's open pages
            if (!e.getValue().equals("127.0.0.1")) { listeners.remove(e.getKey()); try { e.getKey().close(); } catch (IOException ignored) { } }
        send("data: live:server:{}\n\n");   // the wall drops any selection outline
    }

    /** @return true when the connection stays open (event stream) */
    boolean route(String m, String path, String query, Map<String, String> h, byte[] body, Socket s, OutputStream out) throws Exception {
        String ip = s.getInetAddress().isLoopbackAddress() ? "127.0.0.1" : s.getInetAddress().getHostAddress();
        long now = System.currentTimeMillis();
        if (path.equals("/api/hello") && m.equals("POST")) {
            if (!keyOk(h.get("x-key"))) { reply(out, 403, "application/json", "{\"ok\":false}"); return false; }
            okIp = ip; okUntil = now + 15000;
            reply(out, 200, "application/json", "{\"ok\":true}");
            return false;
        }
        if (path.equals("/api/bye") && m.equals("POST")) {
            if (ip.equals(okIp)) lock();
            reply(out, 200, "application/json", "{\"ok\":true}");
            return false;
        }
        if (!ip.equals("127.0.0.1") && !(ip.equals(okIp) && now < okUntil)) { reply(out, 403, "text/html", LOCKED); return false; }
        if (path.equals("/")) { redirect(out, "/control"); return false; }
        if (path.equals("/api/live") && m.equals("POST")) {
            String state = new String(body, StandardCharsets.UTF_8).replaceAll("[\\r\\n]", "");
            if (state.length() > 1000) { reply(out, 413, "text/plain", "too large"); return false; }
            reply(out, 200, "application/json", "{\"ok\":true}");
            send("data: live:" + clean(h.get("x-client")) + ":" + state + "\n\n");
            return false;
        }
        if (path.equals("/wall") || path.equals("/control")) { file(out, new File(web, "index.html")); return false; }
        if (path.equals("/api/events")) {
            s.setSoTimeout(0);
            out.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n: hi\n\n".getBytes(StandardCharsets.UTF_8));
            out.flush();
            listeners.put(out, ip);
            return true;
        }
        if (path.startsWith("/api/kv/")) {
            String key = path.substring(8);
            if (!KEY.matcher(key).matches()) { reply(out, 400, "text/plain", "bad key"); return false; }
            File f = new File(kv, key + ".json");
            if (m.equals("PUT")) {
                Files.write(f, body);
                reply(out, 200, "application/json", "{\"ok\":true}");
                send("data: kv:" + key + ":" + clean(h.get("x-client")) + "\n\n");
            } else reply(out, 200, "application/json", Files.read(f, "null"));
            return false;
        }
        if (path.startsWith("/api/lights")) { lightsRoute(m, path, body, out); return false; }
        if (path.startsWith("/api/sound")) { soundRoute(m, path, body, out); return false; }   // also /api/sounds/
        if (path.equals("/api/system")) { reply(out, 200, "application/json", Health.system(c)); return false; }
        if (path.equals("/api/proxy")) { proxy(out, query); return false; }
        if (path.startsWith("/api/photos/")) {
            String id = path.substring(12);
            if (!PHOTO.matcher(id).matches()) { reply(out, 400, "text/plain", "bad id"); return false; }
            File f = new File(photos, id + ".jpg");
            if (m.equals("PUT")) { Files.write(f, body); reply(out, 200, "application/json", "{\"ok\":true}"); }
            else if (m.equals("DELETE")) { f.delete(); reply(out, 200, "application/json", "{\"ok\":true}"); }
            else file(out, f);
            return false;
        }
        if (path.equals("/api/update") && m.equals("POST")) {
            // the wall shows each stage on its "Updating" screen: download, install, restart (then reload), or failed
            send("data: updating:download\n\n");
            try {
                update();
                send("data: updating:restart\n\n");
                reply(out, 200, "application/json", "{\"ok\":true}");
                send("data: reload\n\n");
            } catch (Exception e) {
                Log.w(TAG, "update failed", e);
                send("data: updating:failed\n\n");
                reply(out, 502, "application/json", "{\"ok\":false}");
            }
            return false;
        }
        // static files, never outside the web folder
        File f = new File(web, path);
        if (!f.getCanonicalPath().startsWith(web.getCanonicalPath() + File.separator)) { reply(out, 403, "text/plain", "no"); return false; }
        file(out, f);
        return false;
    }

    /** The bulb (Lights.java). Bad input = 400; the key is never sent back. */
    void lightsRoute(String m, String path, byte[] body, OutputStream out) throws IOException {
        try {
            if (path.equals("/api/lights") && m.equals("GET")) { reply(out, 200, "application/json", lights.state()); return; }
            if (!m.equals("POST")) { reply(out, 405, "text/plain", "POST only"); return; }
            org.json.JSONObject b = new org.json.JSONObject(body.length == 0 ? "{}" : new String(body, StandardCharsets.UTF_8));
            switch (path) {
                case "/api/lights/light": lights.setLight(Lights.clean(b), true); break;
                case "/api/lights/scene": lights.scene(b.getInt("i")); break;
                case "/api/lights/scene/save": lights.saveScene(b.getInt("i")); break;
                case "/api/lights/settings": lights.settings(b); break;
                case "/api/lights/setup": lights.setup(b); break;
                case "/api/lights/laptop": lights.laptop(b.getBoolean("locked")); break;
                default: reply(out, 404, "text/plain", "not found"); return;
            }
            reply(out, 200, "application/json", lights.state());
        } catch (org.json.JSONException e) { reply(out, 400, "application/json", "{\"ok\":false}"); }
    }

    /** ElevenLabs takes and the sound board (Sound.java). The API key is never sent back. */
    void soundRoute(String m, String path, byte[] body, OutputStream out) throws IOException {
        try {
            if (path.startsWith("/api/sounds/") && m.equals("GET")) {
                File f = sound.file(path.substring(12));
                if (f == null) reply(out, 400, "text/plain", "bad name"); else file(out, f);
                return;
            }
            if (path.startsWith("/api/sound/file/") && m.equals("DELETE")) {
                File f = sound.file(path.substring(16));
                if (f == null) { reply(out, 400, "text/plain", "bad name"); return; }
                f.delete();
                reply(out, 200, "application/json", sound.state());
                send("data: sound:files\n\n");
                return;
            }
            if (path.equals("/api/sound") && m.equals("GET")) { reply(out, 200, "application/json", sound.state()); return; }
            if (path.equals("/api/sound/credits") && m.equals("GET")) { reply(out, 200, "application/json", sound.credits()); return; }
            org.json.JSONObject b = new org.json.JSONObject(body.length == 0 ? "{}" : new String(body, StandardCharsets.UTF_8));
            if (path.equals("/api/sound/key") && m.equals("PUT")) {
                if (!sound.setKey(b.optString("key"))) { reply(out, 400, "application/json", "{\"ok\":false,\"error\":\"That doesn't look like an API key\"}"); return; }
                reply(out, 200, "application/json", sound.state());
                return;
            }
            if (path.equals("/api/sound/generate") && m.equals("POST")) {
                String err = sound.generate(b);
                if (err == null) { reply(out, 200, "application/json", "{\"ok\":true}"); send("data: sound:files\n\n"); }
                else reply(out, 200, "application/json", new org.json.JSONObject().put("ok", false).put("error", err).toString());
                return;
            }
            if (path.equals("/api/sound/play") && m.equals("POST")) {
                String id = b.optString("id").replaceAll("[^a-z0-9-]", ""), v = b.optString("variant").replaceAll("[^a-z0-9-]", "");
                reply(out, 200, "application/json", "{\"ok\":true}");
                send("data: sound:play:" + id + ":" + v + "\n\n");
                return;
            }
            reply(out, 404, "text/plain", "not found");
        } catch (org.json.JSONException e) { reply(out, 400, "application/json", "{\"ok\":false}"); }
    }

    static String clean(String s) { return s == null ? "" : s.replaceAll("[^a-z0-9]", ""); }

    void send(String msg) {
        byte[] b = msg.getBytes(StandardCharsets.UTF_8);
        for (OutputStream o : listeners.keySet()) {
            try { o.write(b); o.flush(); } catch (IOException e) { listeners.remove(o); try { o.close(); } catch (IOException ignored) { } }
        }
    }

    /* ---------- feeds the page can't fetch itself (CORS) ---------- */
    void proxy(OutputStream out, String query) throws IOException {
        String u = query.startsWith("url=") ? URLDecoder.decode(query.substring(4), "UTF-8") : "";
        URL url;
        try { url = new URL(u); } catch (Exception e) { reply(out, 400, "text/plain", "bad url"); return; }
        boolean ok = "https".equals(url.getProtocol());
        boolean allowed = false;
        for (String host : PROXY_HOSTS) allowed |= host.equals(url.getHost());
        if (!ok || !allowed) { reply(out, 403, "text/plain", "host not allowed"); return; }
        HttpURLConnection con = (HttpURLConnection) url.openConnection();
        con.setConnectTimeout(10000);
        con.setReadTimeout(15000);
        con.setRequestProperty("User-Agent", "BearWall");
        try (InputStream in = con.getInputStream()) {
            byte[] b = Files.readAll(in, 3 * 1024 * 1024);
            String type = con.getContentType() == null ? "text/plain" : con.getContentType();
            head(out, 200, type, b.length);
            out.write(b);
        } catch (IOException e) { reply(out, 502, "text/plain", "fetch failed"); }
    }

    /* ---------- Update projector: the newest prototype/ folder from GitHub replaces the web files ---------- */
    void update() throws IOException {
        File tmp = new File(c.getFilesDir(), "web.new");
        Files.deleteTree(tmp);
        HttpURLConnection con = (HttpURLConnection) new URL(REPO_ZIP).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(30000);
        int files = 0;
        try (ZipInputStream zin = new ZipInputStream(new BufferedInputStream(con.getInputStream()))) {
            for (ZipEntry e; (e = zin.getNextEntry()) != null; ) {
                String n = e.getName();
                int i = n.indexOf("/prototype/");
                if (i < 0 || e.isDirectory() || n.contains("..")) continue;
                File f = new File(tmp, n.substring(i + 11));
                f.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(f)) { Files.copy(zin, o); }
                files++;
            }
        }
        if (files == 0 || !new File(tmp, "index.html").exists()) throw new IOException("the download had no prototype/index.html");
        send("data: updating:install\n\n");
        swapIn(tmp);
    }

    /* ---------- responses ---------- */
    /** one header line without its line break; null when the connection closed first */
    static String readLine(InputStream in) throws IOException {
        int ch = in.read();
        if (ch < 0) return null;
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        for (; ch >= 0 && ch != '\n'; ch = in.read()) {
            if (ch != '\r') b.write(ch);
            if (b.size() > 8192) throw new IOException("line too long");
        }
        return b.toString("UTF-8");
    }

    static void head(OutputStream out, int code, String type, long len) throws IOException {
        String status = code == 200 ? "OK" : code == 302 ? "Found" : code == 404 ? "Not Found" : "Error";
        out.write(("HTTP/1.1 " + code + " " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + len
            + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
    }

    static void reply(OutputStream out, int code, String type, String text) throws IOException {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        head(out, code, type + "; charset=utf-8", b.length);
        out.write(b);
        out.flush();
    }

    static void redirect(OutputStream out, String to) throws IOException {
        out.write(("HTTP/1.1 302 Found\r\nLocation: " + to + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    static void file(OutputStream out, File f) throws IOException {
        if (!f.isFile()) { reply(out, 404, "text/plain", "not found"); return; }
        byte[] b = Files.bytes(f);
        head(out, 200, mime(f.getName()), b.length);
        out.write(b);
        out.flush();
    }

    static String mime(String n) {
        n = n.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }
}
