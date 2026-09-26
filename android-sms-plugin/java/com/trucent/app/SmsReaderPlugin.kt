package com.trucent.app

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

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
    permissions = [
        Permission(strings = [Manifest.permission.READ_SMS], alias = "sms")
    ]
)
class SmsReaderPlugin : Plugin() {

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (hasRequiredPermission()) {
            val ret = JSObject()
            ret.put("granted", true)
            call.resolve(ret)
            return
        }
        // Triggers the Android runtime permission dialog; result lands in permissionCallback below.
        requestPermissionForAlias("sms", call, "permissionCallback")
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        val ret = JSObject()
        ret.put("granted", hasRequiredPermission())
        call.resolve(ret)
    }

    private fun hasRequiredPermission(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED
    }

    @PluginMethod
    fun fetchTransactions(call: PluginCall) {
        if (!hasRequiredPermission()) {
            call.reject("READ_SMS permission not granted")
            return
        }

        val sinceDays = call.getInt("sinceDays", 90) ?: 90
        val cutoff = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -sinceDays) }.timeInMillis

        val results = JSArray()
        val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val uri: Uri = Telephony.Sms.Inbox.CONTENT_URI
        val projection = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
        val selection = "${Telephony.Sms.DATE} >= ?"
        val selectionArgs = arrayOf(cutoff.toString())

        try {
            context.contentResolver.query(uri, projection, selection, selectionArgs, "${Telephony.Sms.DATE} DESC")
                ?.use { cursor ->
                    val addressIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
                    val bodyIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
                    val dateIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)

                    while (cursor.moveToNext()) {
                        val sender = cursor.getString(addressIdx) ?: ""
                        val body = cursor.getString(bodyIdx) ?: ""
                        val timestamp = cursor.getLong(dateIdx)

                        val parsed = parseTransaction(body, sender) ?: continue
                        parsed.put("date", dateFmt.format(Date(timestamp)))
                        results.put(parsed)
                    }
                }
            val ret = JSObject()
            ret.put("transactions", results)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to read SMS: ${e.message}")
        }
    }

    /**
     * Heuristic parser for common Indian bank/UPI transaction alert formats.
     * Returns null for anything that doesn't look like a transaction alert
     * (OTPs, promos, delivery updates, etc. are skipped).
     */
    private fun parseTransaction(body: String, sender: String): JSObject? {
        val lower = body.lowercase(Locale.US)

        val isDebit = Regex("debited|spent|paid|withdrawn|purchase of").containsMatchIn(lower)
        val isCredit = Regex("credited|received|deposited").containsMatchIn(lower)
        if (!isDebit && !isCredit) return null

        // Skip OTP / promotional messages that happen to mention "credited" reward points etc.
        if (Regex("otp|one time password|reward point|cashback offer|is your code").containsMatchIn(lower)) return null

        val amountPattern = Pattern.compile("(?:rs\\.?|inr)\\s?([0-9,]+(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE)
        val matcher = amountPattern.matcher(body)
        if (!matcher.find()) return null

        val amountStr = matcher.group(1)?.replace(",", "") ?: return null
        val amount = amountStr.toDoubleOrNull() ?: return null
        if (amount <= 0) return null

        // Try to pull a merchant/VPA name for a cleaner description than the raw SMS.
        val merchantPattern = Pattern.compile(
            "(?:to|at|from|vpa)\\s+([A-Za-z0-9.@_\\-\\s]{3,30}?)(?:\\s+on|\\s+ref|\\s+dated|\\.|,|$)",
            Pattern.CASE_INSENSITIVE
        )
        val merchantMatcher = merchantPattern.matcher(body)
        val desc = if (merchantMatcher.find()) {
            merchantMatcher.group(1)?.trim()?.take(40) ?: sender
        } else {
            sender
        }

        val out = JSObject()
        out.put("desc", if (desc.isNullOrBlank()) sender else desc)
        out.put("amount", amount)
        out.put("type", if (isCredit) "credit" else "debit")
        out.put("sender", sender)
        return out
    }
}
