// Add this to android/app/src/main/java/com/trucent/app/MainActivity.java
// (Capacitor generates this file when you run `npx cap add android` —
// the package path matches the appId "com.trucent.app" set in capacitor.config.json)

package com.trucent.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin() must be called BEFORE super.onCreate() — Capacitor
        // finalizes its plugin registry during super.onCreate(), so anything
        // registered after that point never reaches window.Capacitor.Plugins.
        registerPlugin(SmsReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
