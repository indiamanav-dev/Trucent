package com.trucent.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * HomeWidgetPlugin — TruCent (V-001.P)
 *
 * Writes the small summary payload the home-screen widget displays (net
 * position, earned/spent, next bill, streak) into SharedPreferences, then
 * asks TruCentWidgetProvider to redraw immediately. The payload itself is
 * built in JS by buildWidgetPayload() in src/lib.js — this plugin just
 * persists whatever it's given and triggers a redraw.
 *
 * JS-side contract (see src/App.jsx):
 *   updateWidget({ label, net, earned, spent, nextBillName, nextBillAmount,
 *                  nextBillDue, streak }) -> {}
 */
@CapacitorPlugin(name = "HomeWidget")
public class HomeWidgetPlugin extends Plugin {

    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(TruCentWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();

        putString(editor, call, "label");
        putString(editor, call, "net");
        putString(editor, call, "earned");
        putString(editor, call, "spent");
        putString(editor, call, "nextBillName");
        putString(editor, call, "nextBillAmount");
        putString(editor, call, "nextBillDue");
        Integer streak = call.getInt("streak", 0);
        editor.putInt("streak", streak == null ? 0 : streak);
        editor.apply();

        TruCentWidgetProvider.pushUpdate(context);
        call.resolve(new JSObject());
    }

    private void putString(SharedPreferences.Editor editor, PluginCall call, String key) {
        String v = call.getString(key, "");
        editor.putString(key, v == null ? "" : v);
    }
}
