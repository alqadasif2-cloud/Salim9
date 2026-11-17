package com.sami.tradingchallengetracker.util

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class SamiUpdateReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            // Update replaced successfully
        }
    }
}
