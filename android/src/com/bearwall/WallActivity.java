package com.bearwall;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.DialogInterface;
import android.content.Intent;
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
 * Remote: MENU toggles Window mode, SETTINGS opens a small app menu. Back never leaves the wall, and the POWER key
 * is left alone (a root daemon on the projector handles it). While the light is off (Lcd_en = 0) the page pauses.
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
        ui.postDelayed(lightCheck, 3000);
    }

    final Runnable reload = new Runnable() { public void run() { wv.loadUrl(URL); } };

    // pause the page while the projector's light is off (sleep mode); never touch Lcd_power
    final Runnable lightCheck = new Runnable() { public void run() {
        boolean off = "0".equals(Files.read(LCD, "255").trim());
        if (off != dark) { dark = off; applyPause(); }
        ui.postDelayed(this, 3000);
    }};

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

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
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
