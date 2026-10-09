package com.trucent.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Calendar;

/**
 * SmsReaderPlugin — TruCent (V-001.P)
 *
 * Reads the device's SMS inbox (with explicit runtime permission) and hands
 * raw messages to the JS side. All interpretation — deciding what's a debit,
 * credit, refund, or upcoming bill, extracting amounts and merchant names —
 * happens in src/lib.js, not here. That split is deliberate: lib.js has a
 * real unit-test suite (test/sms.test.mjs) that runs in plain Node, so parsing
 * logic can be verified and improved without rebuilding the Android app. This
 * plugin's only job is "fetch messages that might be financial" — nothing
 * sent anywhere; the data stays on-device and only crosses the JS bridge.
 *
 * JS-side contract (see src/App.jsx -> importFromSms, src/lib.js -> ingestMessages):
 *   requestPermission()           -> { granted: boolean }
 *   fetchMessages({ sinceDays })  -> { messages: [ { sender, body, ts (epoch ms) } ] }
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_SMS }, alias = "sms")
    }
)
public class SmsReaderPlugin extends Plugin {

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasRequiredPermission()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        // Triggers the Android runtime permission dialog; result lands in permissionCallback below.
        requestPermissionForAlias("sms", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasRequiredPermission());
        call.resolve(ret);
    }

    private boolean hasRequiredPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS)
            == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void fetchMessages(PluginCall call) {
        if (!hasRequiredPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }

        int sinceDays = call.getInt("sinceDays", 90);
        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.DAY_OF_YEAR, -sinceDays);
        long cutoff = cal.getTimeInMillis();

        JSArray results = new JSArray();
        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        String[] projection = { Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        String selection = Telephony.Sms.DATE + " >= ?";
        String[] selectionArgs = { String.valueOf(cutoff) };

        try (Cursor cursor = getContext().getContentResolver().query(
                uri, projection, selection, selectionArgs, Telephony.Sms.DATE + " DESC")) {
            if (cursor != null) {
                int addressIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS);
                int bodyIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY);
                int dateIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE);

                while (cursor.moveToNext()) {
                    String sender = cursor.getString(addressIdx);
                    String body = cursor.getString(bodyIdx);
                    long timestamp = cursor.getLong(dateIdx);
                    if (body == null || body.trim().isEmpty()) continue;

                    // Light pre-filter only — skip messages that plainly can't be a
                    // transaction or bill alert, to keep the payload small. Anything
                    // ambiguous is still sent across; lib.js makes the real call.
                    String lower = body.toLowerCase();
                    boolean looksFinancial = lower.indexOf("rs.") >= 0 || lower.indexOf("rs ") >= 0
                        || lower.indexOf("inr") >= 0 || body.indexOf('₹') >= 0
                        || lower.contains("a/c") || lower.contains("account")
                        || lower.contains("card") || lower.contains("upi")
                        || lower.contains("bill") || lower.contains("due")
                        || lower.contains("emi") || lower.contains("premium");
                    if (!looksFinancial) continue;

                    JSObject m = new JSObject();
                    m.put("sender", sender == null ? "" : sender);
                    m.put("body", body);
                    m.put("ts", timestamp);
                    results.put(m);
                }
            }
            JSObject ret = new JSObject();
            ret.put("messages", results);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read SMS: " + e.getMessage());
        }
    }
}
