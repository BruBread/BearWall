package com.bearwall;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;

/**
 * The projector's home screen: the wall, fullscreen, from the app's own server.
 * Remote: MENU toggles Window mode, SETTINGS opens a small app menu, F9 (the light button) toggles Light mode, volume/mute set
 * BearWall's own volume (bulb brightness in Light mode). Back never leaves the wall, and the POWER key
 * is left alone (a root daemon on the projector handles it). In sleep mode (Lcd_en = 0) the wall hides and pauses; waking replays the intro.
 */
public class WallActivity extends Activity {
    static final String URL = "http://127.0.0.1:" + Server.PORT + "/wall";
    static final File LCD = new File("/sys/class/leds/Lcd_en/brightness");

    WebView wv;
    final Handler ui = new Handler(Looper.getMainLooper());
    boolean dark, resumed;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        WebView.setWebContentsDebuggingEnabled(true);   // chrome://inspect from the PC over adb
        wv = new WebView(this);
        wv.setBackgroundColor(Color.BLACK);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // WebView clamps text to 8px by default, which breaks small widgets; let them shrink like they do on the PC
        s.setMinimumFontSize(1);
        s.setMinimumLogicalFontSize(1);
        s.setTextZoom(100);
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) ui.postDelayed(reload, 2000);   // server still starting
            }
        });
        setContentView(wv);
        hideBars();
        wv.loadUrl(URL);
        ui.postDelayed(lightCheck, 500);
        // only holders of DUMP (the adb shell, root scripts like the power daemon) can ask for a sound
        registerReceiver(soundRx, new IntentFilter("com.bearwall.SOUND"), "android.permission.DUMP", null);
    }

    @Override protected void onDestroy() { unregisterReceiver(soundRx); super.onDestroy(); }

    // am broadcast -a com.bearwall.SOUND --es id flip   (the power daemon, when the picture turns 180)
    final BroadcastReceiver soundRx = new BroadcastReceiver() { public void onReceive(Context c, Intent i) {
        String id = i.getStringExtra("id");
        if (id != null && id.matches("[a-z0-9-]{1,40}")) wv.evaluateJavascript("window.BearWallSound && BearWallSound.play('" + id + "')", null);
    }};

    final Runnable reload = new Runnable() { public void run() { wv.loadUrl(URL); } };

    // sleep mode (Lcd_en = 0): hide the wall, then pause the page; on wake, resume and replay the intro. Never touch Lcd_power.
    final Runnable lightCheck = new Runnable() { public void run() {
        boolean off = "0".equals(Files.read(LCD, "255").trim());
        if (off != dark) {
            dark = off;
            if (dark) { wv.evaluateJavascript("window.BearWall && BearWall.sleep()", null); ui.postDelayed(pauseLater, 300); }   // let the hidden frame draw first
            else { applyPause(); wv.evaluateJavascript("window.BearWall && BearWall.wake()", null); }
        }
        ui.postDelayed(this, 500);
    }};
    final Runnable pauseLater = new Runnable() { public void run() { applyPause(); } };

    void applyPause() {
        if (dark || !resumed) { wv.onPause(); wv.pauseTimers(); }
        else { wv.onResume(); wv.resumeTimers(); }
    }

    @Override protected void onResume() { super.onResume(); resumed = true; applyPause(); hideBars(); }
    @Override protected void onPause() { resumed = false; applyPause(); super.onPause(); }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideBars();
    }

    void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override public void onBackPressed() { /* the wall is home: Back never leaves it */ }

    // Light mode: the remote drives the room's bulb (lights.js on the page does the work). F9 = the remote's light
    // button (scan 187, remapped from F6 in the key layout). Volume keys are taken only while it's on.
    boolean lightMode;
    final Runnable lightIdle = new Runnable() { public void run() { setLightMode(false); } };

    void setLightMode(boolean on) {
        lightMode = on;
        ui.removeCallbacks(lightIdle);
        if (on) ui.postDelayed(lightIdle, 10000);   // closes itself after 10 s without a press
        wv.evaluateJavascript("window.BearWall && BearWall.lightMode && BearWall.lightMode(" + on + ")", null);
    }

    static String lightKey(int k) {
        switch (k) {
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER: return "ok";
            case KeyEvent.KEYCODE_VOLUME_UP: return "volup";
            case KeyEvent.KEYCODE_VOLUME_DOWN: return "voldown";
            default: return null;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        if (k == KeyEvent.KEYCODE_F9) {
            if (down && e.getRepeatCount() == 0) setLightMode(!lightMode);
            return true;
        }
        if (lightMode) {
            String key = lightKey(k);
            if (k == KeyEvent.KEYCODE_BACK) { if (down) setLightMode(false); return true; }
            if (key != null) {
                // volume repeats while held (brightness keeps going); the rest act once per press
                if (down && (e.getRepeatCount() == 0 || key.startsWith("vol"))) {
                    setLightMode(true);   // restarts the idle timer
                    wv.evaluateJavascript("window.BearWall && BearWall.lightKey && BearWall.lightKey('" + key + "')", null);
                }
                return true;
            }
        }
        // outside Light mode the volume keys drive BearWall's own volume (the system volume stays at 13, the ceiling)
        String vol = k == KeyEvent.KEYCODE_VOLUME_UP ? "up" : k == KeyEvent.KEYCODE_VOLUME_DOWN ? "down" : k == KeyEvent.KEYCODE_VOLUME_MUTE ? "mute" : null;
        if (vol != null) {
            if (down && (e.getRepeatCount() == 0 || !vol.equals("mute")))
                wv.evaluateJavascript("window.BearWallSound && BearWallSound.volKey('" + vol + "')", null);
            return true;
        }
        if (k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_SETTINGS) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                if (k == KeyEvent.KEYCODE_MENU) wv.evaluateJavascript("window.BearWall && BearWall.toggleWindow && BearWall.toggleWindow()", null);
                else showMenu();
            }
            return true;
        }
        if (k == KeyEvent.KEYCODE_BACK) return true;
        return super.dispatchKeyEvent(e);   // POWER and everything else go on as normal
    }

    // BearWall is the only launcher, so this is how you reach the other apps (HDMI-in switches by itself)
    void showMenu() {
        final String[] names = { "Settings", "Wi-Fi", "Moonlight", "Activity Launcher" };
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Open")
            .setItems(names, new DialogInterface.OnClickListener() { public void onClick(DialogInterface d, int i) {
                Intent it = i == 0 ? new Intent(Settings.ACTION_SETTINGS)
                    : i == 1 ? new Intent(Settings.ACTION_WIFI_SETTINGS)
                    : launch(i == 2 ? "com.limelight" : "de.szalkowski.activitylauncher");
                try {
                    if (it == null) throw new ActivityNotFoundException();
                    startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (ActivityNotFoundException ex) {
                    Toast.makeText(WallActivity.this, names[i] + " isn't installed", Toast.LENGTH_SHORT).show();
                }
            }})
            .show();
    }

    Intent launch(String pkg) {
        Intent it = getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
        return it != null ? it : getPackageManager().getLaunchIntentForPackage(pkg);
    }
}
