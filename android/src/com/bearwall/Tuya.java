package com.bearwall;

import java.io.BufferedInputStream;
import java.io.Closeable;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Tuya's local protocol 3.5, just enough for one bulb: read its data points and set them. Plain Java (no Android),
 * so the same file runs in a desktop test. It follows tinytuya:
 *   frame  = 00006699 | 0000 | seqno | cmd | length | iv(12) | AES-GCM(payload) | tag(16) | 00009966,
 *            with the 14 header bytes after the prefix as GCM associated data; length = iv + payload + tag.
 *   frames from the bulb start (inside the encryption) with a 4-byte return code.
 *   session: send a random 16-byte nonce (cmd 3), the bulb answers its nonce + HMAC(localKey, ours) (cmd 4),
 *            we send HMAC(localKey, its nonce) (cmd 5); session key = AES-GCM(localKey, iv = our nonce[:12])
 *            of (our nonce XOR its nonce), ciphertext only.
 *   commands: DP_QUERY_NEW (16) with "{}"; CONTROL_NEW (13) with "3.5" + 12 zero bytes in front of the JSON.
 */
final class Tuya implements Closeable {
    static final int PORT = 6668;
    static final int SESS_START = 3, SESS_RESP = 4, SESS_FINISH = 5, STATUS = 8, CONTROL_NEW = 13, DP_QUERY_NEW = 16;
    static final byte[] VERSION_HEADER = Arrays.copyOf("3.5".getBytes(StandardCharsets.US_ASCII), 15);
    static final SecureRandom RNG = new SecureRandom();

    final String ip;
    private final byte[] localKey;
    private final Socket socket;
    private final DataInputStream in;
    private final OutputStream out;
    private byte[] key;
    private int seq = 1;

    /** Connects and negotiates the session key; throws if the bulb isn't there or the local key is wrong. */
    Tuya(String ip, String localKey, int connectMs) throws IOException {
        this.ip = ip;
        this.localKey = localKey.getBytes(StandardCharsets.UTF_8);
        socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(ip, PORT), connectMs);
            socket.setSoTimeout(5000);
            in = new DataInputStream(new BufferedInputStream(socket.getInputStream()));
            out = socket.getOutputStream();
            negotiate();
        } catch (IOException e) { close(); throw e; }
    }

    private void negotiate() throws IOException {
        byte[] ours = new byte[16];
        RNG.nextBytes(ours);
        key = localKey;
        send(SESS_START, ours);
        byte[] p = read(SESS_RESP, SESS_RESP);
        if (p.length < 48) throw new IOException("short session answer");
        byte[] theirs = Arrays.copyOf(p, 16);
        if (!MessageDigest.isEqual(hmac(localKey, ours), Arrays.copyOfRange(p, 16, 48))) throw new IOException("wrong local key");
        send(SESS_FINISH, hmac(localKey, theirs));
        byte[] x = new byte[16];
        for (int i = 0; i < 16; i++) x[i] = (byte) (ours[i] ^ theirs[i]);
        key = Arrays.copyOf(gcm(Cipher.ENCRYPT_MODE, localKey, Arrays.copyOf(ours, 12), null, x), 16);
    }

    /** The bulb's status JSON, e.g. {"dps":{"20":true,"21":"white",...}} (whatever wraps "dps" is kept). */
    synchronized String status() throws IOException {
        send(DP_QUERY_NEW, "{}".getBytes(StandardCharsets.UTF_8));
        return json(read(DP_QUERY_NEW, STATUS));
    }

    /** Sets data points from a JSON object string like {"20":true,"22":500}; waits for the bulb's answer. */
    synchronized void set(String dpsJson) throws IOException {
        String body = "{\"protocol\":5,\"t\":" + (System.currentTimeMillis() / 1000) + ",\"data\":{\"dps\":" + dpsJson + "}}";
        byte[] b = body.getBytes(StandardCharsets.UTF_8), p = Arrays.copyOf(VERSION_HEADER, VERSION_HEADER.length + b.length);
        System.arraycopy(b, 0, p, VERSION_HEADER.length, b.length);
        send(CONTROL_NEW, p);
        read(CONTROL_NEW, STATUS);
    }

    private void send(int cmd, byte[] payload) throws IOException {
        byte[] header = ByteBuffer.allocate(18).putInt(0x6699).putShort((short) 0).putInt(seq++).putInt(cmd).putInt(12 + payload.length + 16).array();
        byte[] iv = new byte[12];
        RNG.nextBytes(iv);
        byte[] enc = gcm(Cipher.ENCRYPT_MODE, key, iv, Arrays.copyOfRange(header, 4, 18), payload);
        ByteBuffer f = ByteBuffer.allocate(18 + 12 + enc.length + 4);
        f.put(header).put(iv).put(enc).putInt(0x9966);
        out.write(f.array());
        out.flush();
    }

    /** The next frame from the bulb with command a or b (others, like unasked status pushes, are skipped); its payload. */
    private byte[] read(int a, int b) throws IOException {
        for (int n = 0; n < 8; n++) {
            byte[] header = new byte[18];
            in.readFully(header);
            ByteBuffer h = ByteBuffer.wrap(header);
            if (h.getInt() != 0x6699) throw new IOException("not a 3.5 frame");
            h.getShort(); h.getInt();
            int cmd = h.getInt(), len = h.getInt();
            if (len < 28 + 4 || len > 64 * 1024) throw new IOException("bad frame length " + len);
            byte[] rest = new byte[len + 4];
            in.readFully(rest);
            byte[] plain = gcm(Cipher.DECRYPT_MODE, key, Arrays.copyOf(rest, 12), Arrays.copyOfRange(header, 4, 18), Arrays.copyOfRange(rest, 12, len));
            byte[] payload = plain.length >= 4 ? Arrays.copyOfRange(plain, 4, plain.length) : new byte[0];   // drop the return code
            if (cmd == a || cmd == b) return payload;
        }
        throw new IOException("no answer");
    }

    /** The JSON in a payload, without the "3.5" version header some answers carry. */
    static String json(byte[] p) {
        String s = new String(p, StandardCharsets.UTF_8);
        int i = s.indexOf('{');
        return i < 0 ? "{}" : s.substring(i, s.lastIndexOf('}') + 1);
    }

    private static byte[] gcm(int mode, byte[] k, byte[] iv, byte[] aad, byte[] data) throws IOException {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(mode, new SecretKeySpec(k, "AES"), new GCMParameterSpec(128, iv));
            if (aad != null) c.updateAAD(aad);
            return c.doFinal(data);
        } catch (GeneralSecurityException e) { throw new IOException("crypto: " + e.getMessage()); }
    }

    private static byte[] hmac(byte[] k, byte[] data) throws IOException {
        try {
            Mac m = Mac.getInstance("HmacSHA256");
            m.init(new SecretKeySpec(k, "HmacSHA256"));
            return m.doFinal(data);
        } catch (GeneralSecurityException e) { throw new IOException("crypto: " + e.getMessage()); }
    }

    @Override public void close() { try { socket.close(); } catch (IOException ignored) {} }
}
