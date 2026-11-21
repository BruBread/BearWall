package com.bearwall;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Environment;
import android.os.StatFs;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/**
 * The projector's own stats for /api/system: temperature, storage, memory, boot time and power cuts.
 * Root-only checks (Wi-Fi devices, malware watchdog, ADB) come from a status file a root script on the
 * projector writes (/data/local/tmp/bearwall_status.json); until it exists those values are null.
 *
 * Power cuts: the app writes "alive" every minute. At boot, if the last "alive" is older than this boot and no
 * clean-shutdown note was left, the power was cut between those two times. This projector has no real-time clock,
 * so the check waits until the clock has synced (it is later than the last "alive") before recording anything.
 */
class Health {
    static final String STATUS = "/data/local/tmp/bearwall_status.json";

    static void onBoot(final Context c) {
        new Thread(new Runnable() { public void run() {
            try {
                long lastAlive = Long.parseLong(Files.read(new File(c.getFilesDir(), "alive"), "0").trim());
                boolean clean = new File(c.getFilesDir(), "clean_shutdown").delete();
                for (int i = 0; i < 120 && System.currentTimeMillis() < lastAlive; i++) Thread.sleep(15000);   // wait for the clock
                long bootAt = System.currentTimeMillis() - SystemClock.elapsedRealtime();
                if (lastAlive > 0 && !clean && bootAt > lastAlive) {
                    File f = new File(c.getFilesDir(), "powercuts.json");
                    JSONArray cuts = new JSONArray(Files.read(f, "[]"));
                    cuts.put(new JSONObject().put("from", lastAlive).put("to", bootAt));
                    while (cuts.length() > 20) cuts.remove(0);
                    Files.write(f, cuts.toString());
                }
                while (true) {   // heartbeat
                    Files.write(new File(c.getFilesDir(), "alive"), String.valueOf(System.currentTimeMillis()));
                    Thread.sleep(60000);
                }
            } catch (Exception ignored) { }
        }}, "health").start();
    }

    static void markCleanShutdown(Context c) {
        try { Files.write(new File(c.getFilesDir(), "clean_shutdown"), "1"); } catch (Exception ignored) { }
    }

    static String system(Context c) throws Exception {
        JSONObject o = new JSONObject();
        String t = Files.read(new File("/sys/class/thermal/thermal_zone0/temp"), "").trim();
        if (!t.isEmpty()) o.put("temp", Math.round(Long.parseLong(t) / 1000.0));
        StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
        o.put("storage", new JSONObject().put("used", fs.getTotalBytes() - fs.getAvailableBytes()).put("total", fs.getTotalBytes()));
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        ((ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
        o.put("memory", new JSONObject().put("used", mi.totalMem - mi.availMem).put("total", mi.totalMem));
        o.put("bootAt", System.currentTimeMillis() - SystemClock.elapsedRealtime());
        o.put("powerCuts", new JSONArray(Files.read(new File(c.getFilesDir(), "powercuts.json"), "[]")));
        o.put("lcd", Files.read(new File("/sys/class/leds/Lcd_en/brightness"), "255").trim());
        // root-only checks, written by a root script on the projector (null until that exists)
        JSONObject root = new JSONObject(Files.read(new File(STATUS), "{}"));
        o.put("wifi", root.opt("wifi")).put("malware", root.opt("malware")).put("adb", root.opt("adb"));
        return o.toString();
    }
}
