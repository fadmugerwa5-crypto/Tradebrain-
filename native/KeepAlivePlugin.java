package com.signalbrain.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS bridge: start/stop the foreground service and keep the screen on while auto-trading is armed. */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {
    public static volatile boolean running = false;

    @PluginMethod
    public void start(PluginCall call) {
        final Activity a = getActivity();
        try {
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(a, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(a, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7001);
            }
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), SignalService.class));
            running = true;
            a.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start the background service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        final Activity a = getActivity();
        running = false;
        try {
            getContext().stopService(new Intent(getContext(), SignalService.class));
        } catch (Exception ignored) {
        }
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        call.resolve();
    }

    /** Opens Android's "let this app ignore battery optimization" prompt. Resolves {granted:true} if it is already allowed. */
    @PluginMethod
    public void batteryExemption(PluginCall call) {
        try {
            String pkg = getContext().getPackageName();
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            JSObject r = new JSObject();
            if (pm != null && pm.isIgnoringBatteryOptimizations(pkg)) {
                r.put("granted", true);
                call.resolve(r);
                return;
            }
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + pkg));
            getActivity().startActivity(i);
            r.put("granted", false);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not open the battery setting: " + e.getMessage());
        }
    }
}
