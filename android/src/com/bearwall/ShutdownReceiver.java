package com.bearwall;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Notes a clean shutdown, so the next boot doesn't count it as a power cut. */
public class ShutdownReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        Health.markCleanShutdown(c);
    }
}
