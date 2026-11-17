package com.sami.tradingchallengetracker

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var filePickerLauncher: ActivityResultLauncher<Intent>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>

    private var mediaRecorder: MediaRecorder? = null
    private var voiceRecordingFile: File? = null

    @Volatile
    private var downloadThread: Thread? = null
    @Volatile
    private var isDownloadPaused = false
    @Volatile
    private var isDownloadCancelled = false
    private var updateStateJson = JSONObject().apply {
        put("phase", "idle")
        put("percent", 0)
        put("downloadedBytes", 0)
        put("totalBytes", 0)
        put("speedBytesPerSec", 0)
        put("canResume", false)
    }
    private var verifiedUpdateApkFile: File? = null

    private val prefs by lazy {
        getSharedPreferences("salim_native_prefs", Context.MODE_PRIVATE)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        createNotificationChannel()

        filePickerLauncher = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            val callback = fileUploadCallback
            fileUploadCallback = null
            if (callback == null) return@registerForActivityResult

            if (result.resultCode == RESULT_OK) {
                val data = result.data
                val uris = mutableListOf<Uri>()
                val clipData = data?.clipData
                if (clipData != null) {
                    for (i in 0 until clipData.itemCount) {
                        clipData.getItemAt(i).uri?.let { uris.add(it) }
                    }
                } else {
                    data?.data?.let { uris.add(it) }
                }
                callback.onReceiveValue(if (uris.isNotEmpty()) uris.toTypedArray() else null)
            } else {
                callback.onReceiveValue(null)
            }
        }

        permissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { granted ->
            if (::webView.isInitialized) {
                runOnUiThread {
                    val permStr = if (granted) "granted" else "denied"
                    webView.evaluateJavascript(
                        "window.__samiNativeNotifPerm = '$permStr'; window.dispatchEvent(new CustomEvent('sami_permission_updated'));",
                        null
                    )
                }
            }
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#050811"))
            overScrollMode = WebView.OVER_SCROLL_NEVER

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
            }

            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            addJavascriptInterface(SamiNativeBridge(), "SamiBridge")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    val uri = request.url
                    if (uri.host == "appassets.androidplatform.net") {
                        val rawPath = uri.path ?: "/"
                        val resolvedUri = when {
                            rawPath.isEmpty() || rawPath == "/" ->
                                Uri.parse("https://appassets.androidplatform.net/index.html")
                            !rawPath.contains(".") && !rawPath.startsWith("/api/") ->
                                Uri.parse("https://appassets.androidplatform.net/index.html")
                            else -> uri
                        }
                        val response = assetLoader.shouldInterceptRequest(resolvedUri)
                        if (response != null) {
                            val checkPath = resolvedUri.path ?: ""
                            when {
                                checkPath.endsWith(".js", ignoreCase = true) ||
                                    checkPath.endsWith(".mjs", ignoreCase = true) ->
                                    response.mimeType = "application/javascript"
                                checkPath.endsWith(".css", ignoreCase = true) ->
                                    response.mimeType = "text/css"
                                checkPath.endsWith(".html", ignoreCase = true) ->
                                    response.mimeType = "text/html"
                                checkPath.endsWith(".json", ignoreCase = true) ->
                                    response.mimeType = "application/json"
                                checkPath.endsWith(".png", ignoreCase = true) ->
                                    response.mimeType = "image/png"
                                checkPath.endsWith(".jpg", ignoreCase = true) ||
                                    checkPath.endsWith(".jpeg", ignoreCase = true) ->
                                    response.mimeType = "image/jpeg"
                                checkPath.endsWith(".svg", ignoreCase = true) ->
                                    response.mimeType = "image/svg+xml"
                            }
                            val headers = (response.responseHeaders ?: emptyMap()).toMutableMap()
                            headers["Access-Control-Allow-Origin"] = "*"
                            headers["Cache-Control"] = "no-cache"
                            response.responseHeaders = headers
                            return response
                        }
                    }
                    return super.shouldInterceptRequest(view, request)
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val url = request.url.toString()
                    val host = request.url.host ?: ""
                    if (host == "appassets.androidplatform.net" ||
                        url.startsWith("about:") ||
                        url.startsWith("blob:") ||
                        url.startsWith("data:")
                    ) {
                        return false
                    }
                    return try {
                        val intent = Intent(Intent.ACTION_VIEW, request.url)
                        startActivity(intent)
                        true
                    } catch (_: Throwable) {
                        false
                    }
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = filePathCallback
                    return try {
                        val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                        filePickerLauncher.launch(intent)
                        true
                    } catch (_: Throwable) {
                        fileUploadCallback = null
                        false
                    }
                }

                override fun onPermissionRequest(request: PermissionRequest?) {
                    request ?: return
                    runOnUiThread {
                        request.grant(request.resources)
                    }
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    consoleMessage?.let {
                        Log.d("SamiWebView", "[${it.messageLevel()}] ${it.message()} (${it.sourceId()}:${it.lineNumber()})")
                    }
                    return true
                }
            }
        }

        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        // Fetch FCM token asynchronously if available
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (!token.isNullOrBlank()) {
                    prefs.edit().putString("fcm_token", token).apply()
                    val devId = getOrCreateDeviceId()
                    runOnUiThread {
                        if (::webView.isInitialized) {
                            val safeToken = JSONObject.quote(token)
                            val safeDev = JSONObject.quote(devId)
                            webView.evaluateJavascript(
                                "window.registerAndroidFcmToken && window.registerAndroidFcmToken($safeToken, null, null, $safeDev);",
                                null
                            )
                        }
                    }
                }
            }
        } catch (_: Throwable) {}

        val initialDeepLink = extractDeepLinkJson(intent)
        val initialUrl = if (initialDeepLink != null) {
            "https://appassets.androidplatform.net/index.html?salim_deeplink=${Uri.encode(initialDeepLink.toString())}"
        } else {
            "https://appassets.androidplatform.net/index.html"
        }
        webView.loadUrl(initialUrl)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val dl = extractDeepLinkJson(intent) ?: return
        if (::webView.isInitialized) {
            val safeJson = dl.toString()
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.__samiPendingDeepLink = $safeJson; window.dispatchNotificationDeepLink && window.dispatchNotificationDeepLink($safeJson);",
                    null
                )
            }
        }
    }

    private fun extractDeepLinkJson(intent: Intent?): JSONObject? {
        val extras = intent?.extras ?: return null
        val channelId = extras.getString("channelId") ?: ""
        val partnerId = extras.getString("partnerId") ?: ""
        val senderId = extras.getString("senderId") ?: ""
        val messageId = extras.getString("messageId") ?: ""
        val rawChatType = extras.getString("chatType") ?: ""
        if (channelId.isBlank() && partnerId.isBlank() && senderId.isBlank() && messageId.isBlank() && rawChatType.isBlank()) {
            return null
        }
        val chatType = if (rawChatType == "private" || (channelId.isBlank() && (partnerId.isNotBlank() || senderId.isNotBlank()))) {
            "private"
        } else {
            "channel"
        }
        return JSONObject().apply {
            put("chatType", chatType)
            if (chatType == "channel" && channelId.isNotBlank()) put("channelId", channelId)
            if (chatType == "private") {
                val pVal = partnerId.ifBlank { senderId }
                val pNum = pVal.toLongOrNull()
                if (pNum != null) put("partnerId", pNum) else if (pVal.isNotBlank()) put("partnerId", pVal)
            }
            val sNum = senderId.toLongOrNull()
            if (sNum != null) put("senderId", sNum) else if (senderId.isNotBlank()) put("senderId", senderId)
            if (messageId.isNotBlank()) put("messageId", messageId)
            put("fromNotification", true)
        }
    }

    private fun getOrCreateDeviceId(): String {
        val existing = prefs.getString("device_id", null)
        if (!existing.isNullOrBlank()) return existing
        val generated = "and_${UUID.randomUUID().toString().replace("-", "").take(16)}"
        prefs.edit().putString("device_id", generated).apply()
        return generated
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                "sami_channel_messages_v2",
                "رسائل وتنبيهات سالم",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "إشعارات الدردشة والتوصيات وتحديثات منصة Salim"
                enableVibration(true)
            }
            manager.createNotificationChannel(channel)
        }
    }

    private fun emitUpdateProgress(json: JSONObject) {
        updateStateJson = json
        if (::webView.isInitialized) {
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('sami_update_progress', { detail: ${json} }));",
                    null
                )
            }
        }
    }

    inner class SamiNativeBridge {
        @JavascriptInterface
        fun getInstalledAppInfo(): String {
            return try {
                @Suppress("DEPRECATION")
                val pkgInfo = packageManager.getPackageInfo(packageName, 0)
                val vCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    pkgInfo.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    pkgInfo.versionCode.toLong()
                }
                JSONObject().apply {
                    put("versionCode", vCode)
                    put("versionName", pkgInfo.versionName ?: "1.3.1")
                    put("applicationId", packageName)
                    put("isAndroidNative", true)
                    put("sdkInt", Build.VERSION.SDK_INT)
                }.toString()
            } catch (_: Throwable) {
                """{"versionCode":15,"versionName":"1.3.1","applicationId":"$packageName","isAndroidNative":true}"""
            }
        }

        @JavascriptInterface
        fun getDeviceId(): String = getOrCreateDeviceId()

        @JavascriptInterface
        fun getFcmToken(): String = prefs.getString("fcm_token", "") ?: ""

        @JavascriptInterface
        fun unregisterFcmToken() {
            prefs.edit().remove("fcm_token").apply()
        }

        @JavascriptInterface
        fun syncUserSession(userId: String?, username: String?) {
            prefs.edit()
                .putString("active_user_id", userId ?: "")
                .putString("active_username", username ?: "")
                .apply()
        }

        @JavascriptInterface
        fun onLogout() {
            prefs.edit()
                .remove("active_user_id")
                .remove("active_username")
                .apply()
        }

        @JavascriptInterface
        fun setActiveChatContext(chatType: String?, channelId: String?, partnerId: String?) {
            prefs.edit()
                .putString("active_chat_type", chatType ?: "")
                .putString("active_channel_id", channelId ?: "")
                .putString("active_partner_id", partnerId ?: "")
                .apply()
        }

        @JavascriptInterface
        fun checkNotificationPermission(): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
            } else {
                true
            }
        }

        @JavascriptInterface
        fun requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                runOnUiThread {
                    permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }

        @JavascriptInterface
        fun checkAudioPermission(): Boolean {
            return ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        }

        @JavascriptInterface
        fun requestAudioPermission() {
            runOnUiThread {
                permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }

        @JavascriptInterface
        fun startNativeVoiceRecording(): String {
            return try {
                if (!checkAudioPermission()) {
                    requestAudioPermission()
                    return """{"ok":false,"error":"permission_required"}"""
                }
                cancelNativeVoiceRecording()
                val outFile = File(cacheDir, "voice_${System.currentTimeMillis()}.m4a")
                voiceRecordingFile = outFile
                val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(this@MainActivity)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }
                rec.setAudioSource(MediaRecorder.AudioSource.MIC)
                rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                rec.setAudioEncodingBitRate(64000)
                rec.setAudioSamplingRate(44100)
                rec.setOutputFile(outFile.absolutePath)
                rec.prepare()
                rec.start()
                mediaRecorder = rec
                JSONObject().apply {
                    put("ok", true)
                    put("fileName", outFile.name)
                }.toString()
            } catch (e: Throwable) {
                JSONObject().apply {
                    put("ok", false)
                    put("error", e.message ?: "failed")
                }.toString()
            }
        }

        @JavascriptInterface
        fun stopNativeVoiceRecording(): String {
            return try {
                mediaRecorder?.apply {
                    stop()
                    release()
                }
                mediaRecorder = null
                val f = voiceRecordingFile
                if (f == null || !f.exists()) {
                    return """{"ok":false,"error":"no_file"}"""
                }
                val bytes = f.readBytes()
                if (bytes.size <= 512 * 1024) {
                    val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    JSONObject().apply {
                        put("ok", true)
                        put("mimeType", "audio/mp4")
                        put("base64", b64)
                        put("fileName", f.name)
                        put("size", bytes.size)
                    }.toString()
                } else {
                    JSONObject().apply {
                        put("ok", true)
                        put("mimeType", "audio/mp4")
                        put("fileName", f.name)
                        put("size", bytes.size)
                    }.toString()
                }
            } catch (e: Throwable) {
                mediaRecorder = null
                JSONObject().apply {
                    put("ok", false)
                    put("error", e.message ?: "stop_failed")
                }.toString()
            }
        }

        @JavascriptInterface
        fun getNativeVoiceChunk(fileName: String?, offset: Int, length: Int): String {
            return try {
                if (fileName.isNullOrBlank()) return ""
                val safeName = File(fileName).name
                val f = File(cacheDir, safeName)
                if (!f.exists()) return ""
                val size = f.length().toInt()
                if (offset >= size) return ""
                val toRead = minOf(length, size - offset)
                val buf = ByteArray(toRead)
                FileInputStream(f).use { fis ->
                    fis.skip(offset.toLong())
                    val read = fis.read(buf)
                    if (read <= 0) "" else Base64.encodeToString(buf.copyOf(read), Base64.NO_WRAP)
                }
            } catch (_: Throwable) {
                ""
            }
        }

        @JavascriptInterface
        fun cancelNativeVoiceRecording() {
            try {
                mediaRecorder?.apply {
                    stop()
                    release()
                }
            } catch (_: Throwable) {}
            mediaRecorder = null
            try {
                voiceRecordingFile?.delete()
            } catch (_: Throwable) {}
            voiceRecordingFile = null
        }

        @JavascriptInterface
        fun showNativeNotification(
            title: String?,
            body: String?,
            chatType: String?,
            channelId: String?,
            partnerId: String?,
            messageId: String?,
            senderId: String?,
            senderName: String?
        ) {
            try {
                if (!checkNotificationPermission()) return
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                val resolvedChatType = if (chatType == "private" || (channelId.isNullOrBlank() && (!partnerId.isNullOrBlank() || !senderId.isNullOrBlank()))) "private" else "channel"
                val intent = Intent(this@MainActivity, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("chatType", resolvedChatType)
                    putExtra("channelId", if (resolvedChatType == "channel") (channelId ?: "") else "")
                    putExtra("partnerId", if (resolvedChatType == "private") (partnerId ?: senderId ?: "") else "")
                    putExtra("senderId", senderId ?: "")
                    putExtra("messageId", messageId ?: "")
                    putExtra("senderName", senderName ?: "")
                }
                val pendingIntent = PendingIntent.getActivity(
                    this@MainActivity,
                    (messageId ?: System.currentTimeMillis().toString()).hashCode(),
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val notif = NotificationCompat.Builder(this@MainActivity, "sami_channel_messages_v2")
                    .setSmallIcon(applicationInfo.icon)
                    .setContentTitle(title ?: senderName ?: "Salim")
                    .setContentText(body ?: "رسالة جديدة")
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setContentIntent(pendingIntent)
                    .build()
                manager.notify((messageId ?: System.currentTimeMillis().toString()).hashCode(), notif)
            } catch (_: Throwable) {}
        }

        @JavascriptInterface
        fun getRemoteServerUrl(): String {
            val saved = prefs.getString("remote_server_url", "")?.trim() ?: ""
            return if (saved.isNotEmpty()) saved else "https://ais-pre-huto3ibbtc5qeczlmy4f43-497069235999.europe-west2.run.app"
        }

        @JavascriptInterface
        fun setRemoteServerUrl(url: String?) {
            prefs.edit().putString("remote_server_url", url?.trim() ?: "").apply()
        }

        @JavascriptInterface
        fun openExternalBrowser(url: String?): Boolean {
            return try {
                if (url.isNullOrBlank()) return false
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url.trim())).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
                true
            } catch (_: Throwable) {
                false
            }
        }

        @JavascriptInterface
        fun getUpdateState(): String = updateStateJson.toString()

        @JavascriptInterface
        fun startAppUpdateDownload(configJson: String?, serverBase: String?, authJson: String?) {
            try {
                val cfg = JSONObject(configJson ?: "{}")
                val targetVersionCode = cfg.optInt("versionCode", 0)
                val downloadUrl = cfg.optString("downloadUrl", "").ifBlank {
                    val securePath = cfg.optString("secureDownloadPath", "")
                    if (!serverBase.isNullOrBlank() && securePath.isNotBlank()) {
                        serverBase.trimEnd('/') + securePath
                    } else ""
                }
                if (downloadUrl.isBlank()) {
                    emitUpdateProgress(JSONObject().apply {
                        put("phase", "failed")
                        put("targetVersionCode", targetVersionCode)
                        put("statusTextAr", "رابط تحميل التحديث غير متوفر")
                        put("errorDetailAr", "يرجى المحاولة عبر المتصفح.")
                    })
                    return
                }
                isDownloadPaused = false
                isDownloadCancelled = false
                val authObj = try { JSONObject(authJson ?: "{}") } catch (_: Throwable) { JSONObject() }
                val bearerToken = authObj.optString("token", "")
                val expectedSha = cfg.optString("sha256", "").lowercase()
                val fileName = cfg.optString("fileName", "Salim-update.apk").ifBlank { "Salim-update.apk" }
                val destFile = File(cacheDir, fileName)

                downloadThread?.interrupt()
                downloadThread = thread(start = true) {
                    try {
                        var downloaded = if (destFile.exists()) destFile.length() else 0L
                        val conn = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                            connectTimeout = 15000
                            readTimeout = 30000
                            if (bearerToken.isNotBlank()) {
                                setRequestProperty("Authorization", "Bearer $bearerToken")
                            }
                            if (downloaded > 0) {
                                setRequestProperty("Range", "bytes=$downloaded-")
                            }
                        }
                        val status = conn.responseCode
                        val append = status == HttpURLConnection.HTTP_PARTIAL
                        if (!append) {
                            downloaded = 0L
                        }
                        val contentLen = conn.contentLengthLong
                        val total = if (contentLen > 0) downloaded + contentLen else cfg.optLong("fileSize", 0L)

                        emitUpdateProgress(JSONObject().apply {
                            put("phase", "downloading")
                            put("targetVersionCode", targetVersionCode)
                            put("downloadedBytes", downloaded)
                            put("totalBytes", total)
                            put("percent", if (total > 0) ((downloaded * 100) / total).toInt() else 0)
                            put("statusTextAr", "جارٍ تنزيل التحديث...")
                            put("canResume", true)
                        })

                        conn.inputStream.use { input ->
                            FileOutputStream(destFile, append).use { output ->
                                val buf = ByteArray(16384)
                                var lastEmit = System.currentTimeMillis()
                                var bytesSinceLast = 0L
                                while (!isDownloadCancelled && !isDownloadPaused) {
                                    val read = input.read(buf)
                                    if (read == -1) break
                                    output.write(buf, 0, read)
                                    downloaded += read
                                    bytesSinceLast += read
                                    val now = System.currentTimeMillis()
                                    if (now - lastEmit >= 350) {
                                        val speed = (bytesSinceLast * 1000) / maxOf(1L, now - lastEmit)
                                        val pct = if (total > 0) ((downloaded * 100) / total).toInt().coerceIn(0, 100) else 0
                                        emitUpdateProgress(JSONObject().apply {
                                            put("phase", "downloading")
                                            put("targetVersionCode", targetVersionCode)
                                            put("downloadedBytes", downloaded)
                                            put("totalBytes", total)
                                            put("percent", pct)
                                            put("speedBytesPerSec", speed)
                                            put("statusTextAr", "جارٍ تنزيل التحديث...")
                                            put("canResume", true)
                                        })
                                        lastEmit = now
                                        bytesSinceLast = 0L
                                    }
                                }
                            }
                        }

                        if (isDownloadCancelled) {
                            destFile.delete()
                            emitUpdateProgress(JSONObject().apply {
                                put("phase", "idle")
                                put("targetVersionCode", targetVersionCode)
                                put("percent", 0)
                            })
                            return@thread
                        }
                        if (isDownloadPaused) {
                            emitUpdateProgress(JSONObject().apply {
                                put("phase", "paused")
                                put("targetVersionCode", targetVersionCode)
                                put("downloadedBytes", downloaded)
                                put("totalBytes", total)
                                put("percent", if (total > 0) ((downloaded * 100) / total).toInt() else 0)
                                put("statusTextAr", "تم إيقاف التنزيل مؤقتاً")
                                put("canResume", true)
                            })
                            return@thread
                        }

                        if (expectedSha.isNotBlank()) {
                            val digest = MessageDigest.getInstance("SHA-256")
                            FileInputStream(destFile).use { fis ->
                                val buf = ByteArray(16384)
                                var r: Int
                                while (fis.read(buf).also { r = it } != -1) {
                                    digest.update(buf, 0, r)
                                }
                            }
                            val actualSha = digest.digest().joinToString("") { "%02x".format(it) }
                            if (!actualSha.equals(expectedSha, ignoreCase = true)) {
                                destFile.delete()
                                emitUpdateProgress(JSONObject().apply {
                                    put("phase", "failed")
                                    put("targetVersionCode", targetVersionCode)
                                    put("statusTextAr", "فشل التحقق من سلامة الملف")
                                    put("errorDetailAr", "بصمة SHA-256 غير متطابقة.")
                                })
                                return@thread
                            }
                        }

                        verifiedUpdateApkFile = destFile
                        emitUpdateProgress(JSONObject().apply {
                            put("phase", "verified")
                            put("targetVersionCode", targetVersionCode)
                            put("downloadedBytes", destFile.length())
                            put("totalBytes", destFile.length())
                            put("percent", 100)
                            put("statusTextAr", "اكتمل التحقق — جاهز للتثبيت")
                            put("canResume", false)
                        })
                    } catch (e: Throwable) {
                        emitUpdateProgress(JSONObject().apply {
                            put("phase", "failed")
                            put("targetVersionCode", targetVersionCode)
                            put("statusTextAr", "تعذر تنزيل التحديث")
                            put("errorDetailAr", e.message ?: "خطأ في الشبكة")
                            put("canResume", true)
                        })
                    }
                }
            } catch (_: Throwable) {}
        }

        @JavascriptInterface
        fun pauseAppUpdateDownload(): String {
            isDownloadPaused = true
            updateStateJson.put("phase", "paused")
            return updateStateJson.toString()
        }

        @JavascriptInterface
        fun resumeAppUpdateDownload(): String {
            return updateStateJson.toString()
        }

        @JavascriptInterface
        fun cancelAppUpdateDownload(): String {
            isDownloadCancelled = true
            updateStateJson = JSONObject().apply {
                put("phase", "idle")
                put("percent", 0)
                put("downloadedBytes", 0)
                put("totalBytes", 0)
            }
            return updateStateJson.toString()
        }

        @JavascriptInterface
        fun installVerifiedAppUpdate() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName")
                    )
                    startActivity(intent)
                    return
                }
                val file = verifiedUpdateApkFile ?: return
                if (!file.exists()) return
                val contentUri = FileProvider.getUriForFile(
                    this@MainActivity,
                    "$packageName.fileprovider",
                    file
                )
                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(contentUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(installIntent)
            } catch (_: Throwable) {}
        }
    }
}
