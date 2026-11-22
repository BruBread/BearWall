package com.bearwall;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.regex.Pattern;

/**
 * ElevenLabs sound effects, made on the projector and kept there (filesDir/sounds, never the web folder or the repo:
 * the free plan is non-commercial). One take per click, only when you press Generate on the control page.
 * The API key lives in filesDir/eleven.key and never leaves this class: no reply, log or error message carries it.
 */
final class Sound {
    static final String API = "https://api.elevenlabs.io";
    static final Pattern ID = Pattern.compile("[a-z0-9-]{1,40}"), TAKE = Pattern.compile("g[1-3]"),
        FILE = Pattern.compile("[a-z0-9-]{1,40}\\.g[1-3]\\.mp3"), KEY = Pattern.compile("[\\x21-\\x7e]{10,200}");   // printable, no spaces: safe in a header

    final File keyFile, dir;

    Sound(File filesDir) {
        keyFile = new File(filesDir, "eleven.key");
        dir = new File(filesDir, "sounds");
        dir.mkdirs();
    }

    String key() { return Files.read(keyFile, "").trim(); }

    /** Saves the key; an empty one removes it. */
    boolean setKey(String k) throws IOException {
        k = k == null ? "" : k.trim();
        if (k.isEmpty()) { keyFile.delete(); return true; }
        if (!KEY.matcher(k).matches()) return false;
        Files.write(keyFile, k);
        return true;
    }

    String state() throws JSONException {
        String[] names = dir.list();
        if (names == null) names = new String[0];
        Arrays.sort(names);
        JSONArray files = new JSONArray();
        for (String n : names) if (FILE.matcher(n).matches()) files.put(n);
        return new JSONObject().put("hasKey", !key().isEmpty()).put("files", files).toString();
    }

    File file(String name) { return FILE.matcher(name).matches() ? new File(dir, name) : null; }

    /** Remaining credits: {used, limit, left, resets} or {error}. */
    String credits() throws JSONException {
        String k = key();
        if (k.isEmpty()) return new JSONObject().put("error", "No key").toString();
        try {
            HttpURLConnection con = open(API + "/v1/user/subscription", k, 15000);
            int code = con.getResponseCode();
            if (code != 200) return new JSONObject().put("error", error(con, code, k)).toString();
            JSONObject j;
            try (InputStream in = con.getInputStream()) { j = new JSONObject(new String(Files.readAll(in, 1 << 20), StandardCharsets.UTF_8)); }
            long used = j.optLong("character_count"), limit = j.optLong("character_limit");
            return new JSONObject().put("used", used).put("limit", limit).put("left", Math.max(0, limit - used))
                .put("resets", j.optLong("next_character_count_reset_unix", 0)).toString();
        } catch (IOException e) { return new JSONObject().put("error", "ElevenLabs can't be reached").toString(); }
    }

    /** One take, saved as sounds/<id>.<take>.mp3. Returns null when it worked, else the reason. One at a time. */
    synchronized String generate(JSONObject b) throws JSONException {
        String id = b.optString("id"), take = b.optString("take"), prompt = b.optString("prompt").trim();
        if (!ID.matcher(id).matches() || !TAKE.matcher(take).matches() || prompt.isEmpty() || prompt.length() > 450) return "bad request";
        String k = key();
        if (k.isEmpty()) return "No key";
        double seconds = Math.max(0.5, Math.min(22, b.optDouble("seconds", 5)));
        JSONObject req = new JSONObject().put("text", prompt).put("duration_seconds", seconds).put("prompt_influence", 0.5);
        if (b.optBoolean("loop")) req.put("loop", true);
        try {
            HttpURLConnection con = open(API + "/v1/sound-generation?output_format=mp3_44100_128", k, 60000);
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("Accept", "audio/mpeg");
            try (OutputStream o = con.getOutputStream()) { o.write(req.toString().getBytes(StandardCharsets.UTF_8)); }
            int code = con.getResponseCode();
            if (code != 200) return error(con, code, k);
            byte[] mp3;
            try (InputStream in = con.getInputStream()) { mp3 = Files.readAll(in, 10 * 1024 * 1024); }
            if (mp3.length < 1000) return "ElevenLabs sent back no sound";
            Files.write(new File(dir, id + "." + take + ".mp3"), mp3);
            return null;
        } catch (IOException e) { return "ElevenLabs can't be reached"; }
    }

    static HttpURLConnection open(String url, String key, int readMs) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(readMs);
        con.setRequestProperty("xi-api-key", key);
        con.setRequestProperty("User-Agent", "BearWall");
        return con;
    }

    /** ElevenLabs' own message ({"detail": {"message"}} or {"detail": "..."}), with the key scrubbed just in case. */
    static String error(HttpURLConnection con, int code, String key) {
        String msg = "HTTP " + code;
        try (InputStream in = con.getErrorStream()) {
            if (in != null) {
                JSONObject j = new JSONObject(new String(Files.readAll(in, 1 << 16), StandardCharsets.UTF_8));
                JSONObject d = j.optJSONObject("detail");
                String m = d != null ? d.optString("message", d.optString("status")) : j.optString("detail");
                if (!m.isEmpty()) msg = m;
            }
        } catch (Exception ignored) { }
        if (code == 401) msg = "The key was refused (" + msg + ")";
        msg = msg.replace(key, "…");
        return msg.length() > 300 ? msg.substring(0, 300) : msg;
    }
}
