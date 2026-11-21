package com.bearwall;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * The room's Tuya bulb, run from the projector all day (a port of the laptop's TuyaLightsControl server.py):
 * the wanted light, 4 scenes, a sunrise fade-in, an evening warm-down and follow-laptop (dark while the laptop
 * reports it's locked). Everything lives in filesDir/lights.json; the local key never leaves this class.
 * Light fields: on, mode (white | colour), h 0-360, s 0-1000, bright 10-1000, temp 0-1000 (warm 0 .. cold 1000).
 */
final class Lights {
    static final String TAG = "BearWallLights";
    static final long MIN_GAP = 400;   // ms between bulb commands; faster and the bulb queues them up and freezes
    static final long PROBE = 10000;   // ms: while nothing changes, read the bulb (also catches changes from the Tuya app)
    static final long TICK = 5000;     // ms between schedule checks

    final File file;
    final Server server;
    JSONObject device;     // id, key, version, lastIp
    JSONObject settings;   // scenes, sunrise, warm, follow
    JSONObject light = L(true, "white", 0, 0, 1000, 1000);
    int ver = 0;           // bumps on every wanted change, so a bulb read never overwrites a change still on its way
    boolean dark = false, found = false, wake = false;
    String ip = null;
    final Set<String> skip = new HashSet<>();      // schedule windows the user overrode by hand: name@start
    Set<String> active = new HashSet<>();          // schedule windows running right now
    final Map<String, JSONObject> warmFrom = new HashMap<>();

    Lights(File dir, Server server) {
        this.file = new File(dir, "lights.json");
        this.server = server;
        JSONObject saved;
        try { saved = new JSONObject(Files.read(file, "{}")); } catch (JSONException e) { saved = new JSONObject(); }
        device = saved.optJSONObject("device");
        settings = defaults();
        JSONObject s = saved.optJSONObject("settings");
        if (s != null) try {
            if (s.optJSONArray("scenes") != null && s.getJSONArray("scenes").length() == 4) settings.put("scenes", s.getJSONArray("scenes"));
            for (String k : new String[] { "sunrise", "warm", "follow" }) {
                JSONObject o = s.optJSONObject(k);
                if (o != null) for (java.util.Iterator<String> it = o.keys(); it.hasNext(); ) { String f = it.next(); settings.getJSONObject(k).put(f, o.get(f)); }
            }
        } catch (JSONException ignored) { }
    }

    static JSONObject L(boolean on, String mode, int h, int s, int bright, int temp) {
        try { return new JSONObject().put("on", on).put("mode", mode).put("h", h).put("s", s).put("bright", bright).put("temp", temp); }
        catch (JSONException e) { throw new IllegalStateException(e); }
    }

    static JSONObject defaults() {
        try {
            return new JSONObject()
                .put("scenes", new JSONArray()
                    .put(scene("Focus", "💡", L(true, "white", 0, 0, 1000, 1000)))
                    .put(scene("Chill", "🧸", L(true, "white", 0, 0, 350, 150)))
                    .put(scene("Movie", "🍿", L(true, "colour", 230, 900, 250, 0)))
                    .put(scene("Night", "🌙", L(true, "colour", 10, 1000, 30, 0))))
                .put("sunrise", new JSONObject().put("on", false).put("time", "06:30").put("minutes", 25))      // fades up, ending at time
                .put("warm", new JSONObject().put("on", false).put("time", "21:00").put("minutes", 60).put("bright", 300))   // warms, starting at time
                .put("follow", new JSONObject().put("on", false));
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }

    static JSONObject scene(String name, String icon, JSONObject light) throws JSONException {
        return new JSONObject().put("name", name).put("icon", icon).put("light", light);
    }

    void start() {
        new BulbLoop().start();
        new ScheduleLoop().start();
    }

    synchronized void save() {
        try { Files.write(file, new JSONObject().put("device", device).put("settings", settings).toString()); }
        catch (Exception e) { Log.w(TAG, "save failed", e); }
    }

    /** What the page sees. Never the key. */
    synchronized String state() {
        try {
            JSONArray act = new JSONArray();
            for (String a : active) if (!act.toString().contains("\"" + a.split("@")[0] + "\"")) act.put(a.split("@")[0]);
            return new JSONObject().put("light", light).put("settings", settings).put("active", act)
                .put("bulb", new JSONObject().put("found", found).put("ip", ip == null ? JSONObject.NULL : ip).put("setup", device != null)).toString();
        } catch (JSONException e) { return "{}"; }
    }

    void changed() { server.send("data: lights\n\n"); }

    /* ---------- the page's requests (Server routes them; bad input throws) ---------- */

    void setLight(JSONObject ch, boolean byHand) throws JSONException {
        synchronized (this) {
            for (java.util.Iterator<String> it = ch.keys(); it.hasNext(); ) { String k = it.next(); light.put(k, ch.get(k)); }
            ver++;
            if (byHand) skip.addAll(active);   // touching the light stops the running schedule until its next window
            wake = true;
            notifyAll();
        }
        changed();
    }

    static JSONObject clean(JSONObject ch) throws JSONException {
        JSONObject out = new JSONObject();
        if (ch.has("on")) out.put("on", ch.getBoolean("on"));
        String mode = ch.optString("mode", "");
        if (mode.equals("white") || mode.equals("colour")) out.put("mode", mode);
        String[] keys = { "h", "s", "bright", "temp" };
        int[] lo = { 0, 0, 10, 0 }, hi = { 360, 1000, 1000, 1000 };
        for (int i = 0; i < keys.length; i++) if (ch.has(keys[i])) out.put(keys[i], Math.max(lo[i], Math.min(hi[i], ch.getInt(keys[i]))));
        return out;
    }

    void scene(int i) throws JSONException {
        JSONObject l;
        synchronized (this) { l = settings.getJSONArray("scenes").getJSONObject(i).getJSONObject("light"); }
        setLight(clean(l), true);
    }

    void saveScene(int i) throws JSONException {
        synchronized (this) { settings.getJSONArray("scenes").getJSONObject(i).put("light", new JSONObject(light.toString())); }
        save(); changed();
    }

    void settings(JSONObject body) throws JSONException {
        synchronized (this) {
            JSONObject sr = body.optJSONObject("sunrise"), wm = body.optJSONObject("warm"), fo = body.optJSONObject("follow");
            if (sr != null) cleanTimed(sr, settings.getJSONObject("sunrise"), false);
            if (wm != null) cleanTimed(wm, settings.getJSONObject("warm"), true);
            if (fo != null && fo.has("on")) settings.getJSONObject("follow").put("on", fo.getBoolean("on"));
            if (!settings.getJSONObject("follow").getBoolean("on")) dark = false;
            wake = true; notifyAll();
        }
        save(); changed();
    }

    static void cleanTimed(JSONObject in, JSONObject to, boolean bright) throws JSONException {
        if (in.has("on")) to.put("on", in.getBoolean("on"));
        if (in.has("time") && in.getString("time").matches("([01]\\d|2[0-3]):[0-5]\\d")) to.put("time", in.getString("time"));
        if (in.has("minutes")) to.put("minutes", Math.max(1, Math.min(240, in.getInt("minutes"))));
        if (bright && in.has("bright")) to.put("bright", Math.max(10, Math.min(1000, in.getInt("bright"))));
    }

    void setup(JSONObject body) throws JSONException {
        String id = body.getString("id").trim(), key = body.getString("key");
        if (!id.matches("[A-Za-z0-9]{10,32}") || !key.matches("[\\x21-\\x7e]{16}")) throw new JSONException("bad id or key");
        synchronized (this) {
            device = new JSONObject().put("id", id).put("key", key).put("version", body.optString("version", "3.5"));
            ip = null; found = false;
            wake = true; notifyAll();
        }
        save(); changed();
    }

    /** BearWall Control on the laptop reports its lock state; with follow-laptop on, the light goes dark while locked. */
    void laptop(boolean locked) {
        synchronized (this) {
            boolean d = locked && settings.optJSONObject("follow").optBoolean("on");
            if (d == dark) return;
            dark = d; wake = true; notifyAll();
        }
        changed();
    }

    /* ---------- the bulb ---------- */

    synchronized JSONObject effective() {
        try { JSONObject e = new JSONObject(light.toString()); if (dark) e.put("on", false); return e; }
        catch (JSONException e) { return light; }
    }

    /** dps as a fixed-order JSON string, so two can be compared as text. */
    static String dps(JSONObject l) {
        if (!l.optBoolean("on")) return "{\"20\":false}";
        if (l.optString("mode").equals("white")) return "{\"20\":true,\"21\":\"white\",\"22\":" + l.optInt("bright") + ",\"23\":" + l.optInt("temp") + "}";
        return "{\"20\":true,\"21\":\"colour\",\"24\":\"" + String.format("%04x%04x%04x", l.optInt("h"), l.optInt("s"), l.optInt("bright")) + "\"}";
    }

    /** The bulb's dps as light fields, or null in a mode this page doesn't show (the Tuya app's scene/music modes). */
    static JSONObject parse(JSONObject d) throws JSONException {
        if (!d.optBoolean("20", true)) return new JSONObject().put("on", false);
        if ("white".equals(d.optString("21"))) return new JSONObject().put("on", true).put("mode", "white").put("bright", d.optInt("22", 1000)).put("temp", d.optInt("23", 1000));
        String c = d.optString("24");
        if ("colour".equals(d.optString("21")) && c.length() == 12)
            return new JSONObject().put("on", true).put("mode", "colour").put("h", Integer.parseInt(c.substring(0, 4), 16))
                .put("s", Integer.parseInt(c.substring(4, 8), 16)).put("bright", Math.max(10, Integer.parseInt(c.substring(8, 12), 16)));
        return null;
    }

    /** waits for a change or the probe interval; true when something changed */
    synchronized boolean waitWake(long ms) {
        if (!wake) try { wait(ms); } catch (InterruptedException ignored) { }
        boolean w = wake; wake = false; return w;
    }

    final class BulbLoop extends Thread {
        Tuya bulb;
        JSONObject usedDev;   // the setup the open connection belongs to (a new setup reconnects)
        String shown;
        long last;
        int done;

        @Override public void run() {
            wake = true;
            while (true) {
                boolean changed = waitWake(PROBE);
                long gap = last + MIN_GAP - System.currentTimeMillis();
                if (gap > 0) try { Thread.sleep(gap); } catch (InterruptedException ignored) { }
                JSONObject dev;
                synchronized (Lights.this) { dev = device; }
                if (dev == null) { setFound(false); continue; }
                if (bulb != null && dev != usedDev) { bulb.close(); bulb = null; }
                String want = dps(effective());
                int v;
                synchronized (Lights.this) { v = ver; }
                String before = state();
                try {
                    if (bulb == null) { bulb = connect(dev); usedDev = dev; shown = null; }
                    if (shown == null || (!changed && want.equals(shown))) {
                        JSONObject d = new JSONObject(bulb.status()).optJSONObject("dps");
                        JSONObject got = d == null ? null : parse(d);
                        synchronized (Lights.this) {
                            if (got != null && v == ver && ver == done && !dark)
                                for (java.util.Iterator<String> it = got.keys(); it.hasNext(); ) { String k = it.next(); light.put(k, got.get(k)); }
                        }
                        if (got != null) {
                            JSONObject merged;
                            synchronized (Lights.this) { merged = new JSONObject(light.toString()); }
                            for (java.util.Iterator<String> it = got.keys(); it.hasNext(); ) { String k = it.next(); merged.put(k, got.get(k)); }
                            shown = dps(merged);
                        } else shown = want;   // the app's own scene/music mode: leave it alone
                        want = got == null ? shown : dps(effective());
                    }
                    if (!want.equals(shown)) {
                        bulb.set(want);
                        shown = want;
                        last = System.currentTimeMillis();
                    }
                    done = v;
                    setFound(true);
                } catch (Exception e) {
                    if (found) Log.w(TAG, "bulb not answering: " + e);
                    if (bulb != null) bulb.close();
                    bulb = null; shown = null;
                    setFound(false);
                    try { Thread.sleep(20000); } catch (InterruptedException ignored) { }   // a scan of the Wi-Fi every ~30 s while it's missing
                }
                if (!before.equals(state())) changed();
            }
        }
    }

    synchronized void setFound(boolean f) { found = f; if (!f && device == null) ip = null; }

    /** The bulb: its last address first, else every host on this Wi-Fi (/24) with port 6668 open that takes our key. */
    Tuya connect(JSONObject dev) throws IOException {
        String key = dev.optString("key"), last = dev.optString("lastIp", "");
        if (!last.isEmpty()) try { Tuya t = new Tuya(last, key, 1500); setIp(last); return t; } catch (IOException ignored) { }
        String base = subnet();
        if (base == null) throw new IOException("no Wi-Fi address");
        ExecutorService pool = Executors.newFixedThreadPool(32);
        try {
            List<Future<String>> knocks = new ArrayList<>();
            for (int i = 1; i < 255; i++) knocks.add(pool.submit(new Knock(base + i)));
            for (Future<String> f : knocks) {
                String host;
                try { host = f.get(); } catch (Exception e) { continue; }
                if (host == null) continue;
                try { Tuya t = new Tuya(host, key, 1500); setIp(host); return t; } catch (IOException ignored) { }
            }
        } finally { pool.shutdownNow(); }
        throw new IOException("bulb not found on this Wi-Fi (switched off at the wall?)");
    }

    void setIp(String host) {
        synchronized (this) {
            ip = host;
            try { if (device != null && !host.equals(device.optString("lastIp"))) device.put("lastIp", host); else return; }
            catch (JSONException e) { return; }
        }
        save();
    }

    /** "192.168.1." for the projector's own IPv4 address. */
    static String subnet() {
        try {
            for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!n.isUp() || n.isLoopback()) continue;
                for (InetAddress a : Collections.list(n.getInetAddresses()))
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) { String s = a.getHostAddress(); return s.substring(0, s.lastIndexOf('.') + 1); }
            }
        } catch (Exception ignored) { }
        return null;
    }

    static final class Knock implements Callable<String> {
        final String host;
        Knock(String host) { this.host = host; }
        public String call() {
            try (Socket s = new Socket()) { s.connect(new InetSocketAddress(host, Tuya.PORT), 400); return host; }
            catch (IOException e) { return null; }
        }
    }

    /* ---------- schedules ---------- */

    /** The [start, end] window (ms) around now: ends=true ends at hh:mm (sunrise), else starts there. null if outside. */
    static long[] window(long now, String hhmm, int minutes, boolean ends) {
        String[] p = hhmm.split(":");
        for (int d = -1; d <= 1; d++) {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(now);
            c.add(Calendar.DAY_OF_MONTH, d);
            c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(p[0])); c.set(Calendar.MINUTE, Integer.parseInt(p[1]));
            c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
            long t = c.getTimeInMillis(), a = ends ? t - minutes * 60000L : t, b = ends ? t : t + minutes * 60000L;
            if (a <= now && now <= b) return new long[] { a, b };
        }
        return null;
    }

    void tick(long now) throws JSONException {
        Set<String> act = new HashSet<>();
        JSONObject ch = null;
        synchronized (this) {
            JSONObject sr = settings.getJSONObject("sunrise"), wm = settings.getJSONObject("warm");
            long[] w = sr.getBoolean("on") ? window(now, sr.getString("time"), sr.getInt("minutes"), true) : null;
            if (w != null && !skip.contains("sunrise@" + w[0])) {
                act.add("sunrise@" + w[0]);
                double p = (now - w[0]) / (double) (w[1] - w[0]);
                ch = new JSONObject().put("on", true).put("mode", "white").put("bright", (int) Math.round(10 + 990 * p)).put("temp", (int) Math.round(500 * p));
                dark = false;   // the morning wins over a locked laptop
            }
            w = wm.getBoolean("on") ? window(now, wm.getString("time"), wm.getInt("minutes"), false) : null;
            String key = w == null ? null : "warm@" + w[0];
            // only a white light gets warmer: a colour (a Movie or Night scene) was picked on purpose
            if (w != null && ch == null && !skip.contains(key) && (warmFrom.containsKey(key) || (light.optBoolean("on") && light.optString("mode").equals("white")))) {
                if (!warmFrom.containsKey(key)) warmFrom.put(key, new JSONObject(light.toString()));
                JSONObject f = warmFrom.get(key);
                double p = (now - w[0]) / (double) (w[1] - w[0]);
                int end = Math.min(f.getInt("bright"), wm.getInt("bright"));
                act.add(key);
                ch = new JSONObject().put("bright", (int) Math.round(f.getInt("bright") + (end - f.getInt("bright")) * p)).put("temp", (int) Math.round(f.getInt("temp") * (1 - p)));
            }
            active = act;
        }
        if (ch != null) setLight(ch, false);
    }

    final class ScheduleLoop extends Thread {
        @Override public void run() {
            while (true) {
                try { tick(System.currentTimeMillis()); } catch (Exception e) { Log.w(TAG, "schedule", e); }
                try { Thread.sleep(TICK); } catch (InterruptedException ignored) { }
            }
        }
    }
}
