package com.tradebrain.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** While auto-trading is armed, keep the page's timers and network running when the app goes to the background. */
    private void keepPageRunning() {
        if (!KeepAlivePlugin.running) return;
        if (getBridge() == null) return;
        WebView w = getBridge().getWebView();
        if (w == null) return;
        w.onResume();
        w.resumeTimers();
    }

    @Override
    public void onPause() {
        super.onPause();
        keepPageRunning();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepPageRunning();
    }
}
