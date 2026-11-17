package com.sami.tradingchallengetracker.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sami.tradingchallengetracker.MainActivity

class SamiFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        getSharedPreferences("salim_native_prefs", Context.MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token)
            .apply()
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        try {
            val title = remoteMessage.notification?.title
                ?: remoteMessage.data["title"]
                ?: "Salim"
            val body = remoteMessage.notification?.body
                ?: remoteMessage.data["body"]
                ?: "لديك إشعار جديد"

            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    "sami_channel_messages_v2",
                    "رسائل وتنبيهات سالم",
                    NotificationManager.IMPORTANCE_HIGH
                )
                manager.createNotificationChannel(channel)
            }

            val chatType = remoteMessage.data["chatType"] ?: "channel"
            val channelId = remoteMessage.data["channelId"] ?: ""
            val partnerId = remoteMessage.data["partnerId"] ?: ""
            val senderId = remoteMessage.data["senderId"] ?: ""
            val messageId = remoteMessage.data["messageId"] ?: ""
            val senderName = remoteMessage.data["senderName"] ?: ""

            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("chatType", chatType)
                putExtra("channelId", channelId)
                putExtra("partnerId", partnerId)
                putExtra("senderId", senderId)
                putExtra("messageId", messageId)
                putExtra("senderName", senderName)
            }
            val reqCode = (messageId.ifBlank { System.currentTimeMillis().toString() }).hashCode()
            val pendingIntent = PendingIntent.getActivity(
                this,
                reqCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(this, "sami_channel_messages_v2")
                .setSmallIcon(applicationInfo.icon)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .build()

            manager.notify(reqCode, notification)
        } catch (_: Throwable) {}
    }
}
