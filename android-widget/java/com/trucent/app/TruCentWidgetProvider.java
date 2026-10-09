package com.trucent.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * TruCentWidgetProvider — the home-screen widget shown in the Android launcher.
 *
 * It never talks to the SMS inbox or does any computation itself — it only
 * reads whatever HomeWidgetPlugin last wrote into SharedPreferences (see that
 * file for the data contract) and draws it into a few TextViews. All the real
 * math (net position, next bill, streak) happens in src/lib.js, inside the
 * app, exactly once, and is then just displayed here.
 */
public class TruCentWidgetProvider extends AppWidgetProvider {
    public static final String PREFS_NAME = "TruCentWidgetPrefs";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, id);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_trucent);

        boolean hasData = prefs.contains("net");
        if (!hasData) {
            views.setTextViewText(R.id.widget_label, "TruCent");
            views.setTextViewText(R.id.widget_net, "Open app to sync");
            views.setTextViewText(R.id.widget_subline, "No data yet");
            views.setTextViewText(R.id.widget_bill, "");
        } else {
            views.setTextViewText(R.id.widget_label, prefs.getString("label", "NET THIS MONTH"));
            views.setTextViewText(R.id.widget_net, prefs.getString("net", "—"));
            String earned = prefs.getString("earned", "₹0");
            String spent = prefs.getString("spent", "₹0");
            views.setTextViewText(R.id.widget_subline, "In " + earned + "  ·  Out " + spent);

            String billName = prefs.getString("nextBillName", "");
            if (billName != null && !billName.isEmpty()) {
                String billAmt = prefs.getString("nextBillAmount", "");
                String billDue = prefs.getString("nextBillDue", "");
                views.setTextViewText(R.id.widget_bill, billName + " " + billAmt + " · " + billDue);
            } else {
                int streak = prefs.getInt("streak", 0);
                views.setTextViewText(R.id.widget_bill, streak > 0 ? streak + "-day streak" : "Nothing due");
            }
        }

        // Tapping anywhere on the widget opens the app.
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, flags);
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    /** Called by HomeWidgetPlugin right after it writes fresh data, so the widget
     *  updates immediately instead of waiting for the next scheduled refresh. */
    static void pushUpdate(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName thisWidget = new ComponentName(context, TruCentWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(thisWidget);
        for (int id : ids) {
            updateAppWidget(context, mgr, id);
        }
    }
}
