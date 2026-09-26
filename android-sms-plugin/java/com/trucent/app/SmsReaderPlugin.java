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

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SmsReaderPlugin — TruCent (V-001.P)
 *
 * Reads the device's SMS inbox (with explicit runtime permission) and parses
 * bank/UPI debit & credit alerts into structured transactions. Nothing is
 * sent anywhere — parsing happens entirely on-device, and only the parsed
 * results (never raw SMS content) cross the JS bridge.
 *
 * JS-side contract (see src/App.jsx -> importFromSms):
 *   requestPermission()              -> { granted: boolean }
 *   fetchTransactions({ sinceDays }) -> { transactions: [
 *       { desc, amount (always positive), date: "YYYY-MM-DD", type: "debit"|"credit", sender }
 *   ]}
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
    public void fetchTransactions(PluginCall call) {
        if (!hasRequiredPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }

        int sinceDays = call.getInt("sinceDays", 90);
        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.DAY_OF_YEAR, -sinceDays);
        long cutoff = cal.getTimeInMillis();

        JSArray results = new JSArray();
        SimpleDateFormat dateFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
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
                    if (sender == null) sender = "";
                    if (body == null) body = "";

                    JSObject parsed = parseTransaction(body, sender);
                    if (parsed == null) continue;
                    parsed.put("date", dateFmt.format(new Date(timestamp)));
                    results.put(parsed);
                }
            }
            JSObject ret = new JSObject();
            ret.put("transactions", results);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read SMS: " + e.getMessage());
        }
    }

    /**
     * Heuristic parser for common Indian bank/UPI transaction alert formats.
     * Returns null for anything that doesn't look like a transaction alert
     * (OTPs, promos, delivery updates, etc. are skipped).
     */
    private JSObject parseTransaction(String body, String sender) {
        String lower = body.toLowerCase(Locale.US);

        boolean isDebit = Pattern.compile("debited|spent|paid|withdrawn|purchase of").matcher(lower).find();
        boolean isCredit = Pattern.compile("credited|received|deposited").matcher(lower).find();
        if (!isDebit && !isCredit) return null;

        // Skip OTP / promotional messages that happen to mention "credited" reward points etc.
        if (Pattern.compile("otp|one time password|reward point|cashback offer|is your code").matcher(lower).find()) {
            return null;
        }

        Pattern amountPattern = Pattern.compile("(?:rs\\.?|inr)\\s?([0-9,]+(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
        Matcher matcher = amountPattern.matcher(body);
        if (!matcher.find()) return null;

        String amountStr = matcher.group(1);
        if (amountStr == null) return null;
        amountStr = amountStr.replace(",", "");
        double amount;
        try {
            amount = Double.parseDouble(amountStr);
        } catch (NumberFormatException e) {
            return null;
        }
        if (amount <= 0) return null;

        // Try to pull a merchant/VPA name for a cleaner description than the raw SMS.
        Pattern merchantPattern = Pattern.compile(
            "(?:to|at|from|vpa)\\s+([A-Za-z0-9.@_\\-\\s]{3,30}?)(?:\\s+on|\\s+ref|\\s+dated|\\.|,|$)",
            Pattern.CASE_INSENSITIVE
        );
        Matcher merchantMatcher = merchantPattern.matcher(body);
        String desc;
        if (merchantMatcher.find() && merchantMatcher.group(1) != null) {
            desc = merchantMatcher.group(1).trim();
            if (desc.length() > 40) desc = desc.substring(0, 40);
        } else {
            desc = sender;
        }
        if (desc == null || desc.trim().isEmpty()) desc = sender;

        JSObject out = new JSObject();
        out.put("desc", desc);
        out.put("amount", amount);
        out.put("type", isCredit ? "credit" : "debit");
        out.put("sender", sender);
        return out;
    }
}
