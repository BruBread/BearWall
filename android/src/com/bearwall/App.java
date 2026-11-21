package com.bearwall;

import android.app.Application;

/** Starts the web server as soon as the app process starts (as HOME, Android starts it at every boot). */
public class App extends Application {
    static Server server;

    @Override
    public void onCreate() {
        super.onCreate();
        Health.onBoot(this);
        server = new Server(this);
        server.start();
    }
}
