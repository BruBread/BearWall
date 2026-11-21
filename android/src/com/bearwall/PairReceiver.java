package com.bearwall;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.io.File;

/**
 * Pairs your laptop: stores the key the BearWall Control panel will send. Only the adb shell can reach this
 * (the receiver needs the DUMP permission, which ordinary apps can't get), so only your PC can pair.
 *   adb shell am broadcast -a com.bearwall.PAIR -n com.bearwall/.PairReceiver --es key <key>
 */
public class PairReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String k = i.getStringExtra("key");
        if (k == null || !k.matches("[A-Za-z0-9]{16,64}")) { setResultData("bad key"); return; }
        try { Files.write(new File(c.getFilesDir(), "pair.key"), k); setResultData("paired"); }
        catch (Exception e) { setResultData("failed"); }
    }
}
