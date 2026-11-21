package com.bearwall;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Small file helpers (Java 8, no libraries). Writes go to a temp file first, then replace the old one. */
class Files {
    static String read(File f, String fallback) {
        try { return new String(bytes(f), StandardCharsets.UTF_8); } catch (IOException e) { return fallback; }
    }

    static byte[] bytes(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) { return readAll(in, Integer.MAX_VALUE); }
    }

    static void write(File f, String s) throws IOException { write(f, s.getBytes(StandardCharsets.UTF_8)); }

    static void write(File f, byte[] b) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) { out.write(b); }
        if (!tmp.renameTo(f)) { f.delete(); if (!tmp.renameTo(f)) throw new IOException("could not save " + f); }
    }

    static byte[] readAll(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > max) throw new IOException("too large");
        }
        return out.toByteArray();
    }

    static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
