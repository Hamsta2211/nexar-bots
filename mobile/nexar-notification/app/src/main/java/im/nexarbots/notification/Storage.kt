package im.nexarbots.notification

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val cacheJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

class CredentialStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "nexar_notification_credentials",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun get(): DeviceCredentials? {
        val baseUrl = prefs.getString("base_url", null) ?: return null
        val deviceId = prefs.getString("device_id", null) ?: return null
        val deviceToken = prefs.getString("device_token", null) ?: return null
        return DeviceCredentials(baseUrl, deviceId, deviceToken)
    }

    fun save(credentials: DeviceCredentials) = prefs.edit()
        .putString("base_url", credentials.baseUrl.trimEnd('/'))
        .putString("device_id", credentials.deviceId)
        .putString("device_token", credentials.deviceToken)
        .apply()

    fun pendingFcmToken(): String? = prefs.getString("pending_fcm_token", null)
    fun savePendingFcmToken(token: String) = prefs.edit().putString("pending_fcm_token", token).apply()
    fun clearPendingFcmToken() = prefs.edit().remove("pending_fcm_token").apply()

    fun clear() = prefs.edit().clear().apply()
}

class EventCache(context: Context) {
    private val prefs = context.getSharedPreferences("nexar_notification_events", Context.MODE_PRIVATE)

    fun save(event: MobileEvent) {
        prefs.edit()
            .putString("event_${event.id}", cacheJson.encodeToString(event))
            .putString("pending_event_id", event.id)
            .apply()
    }

    fun get(eventId: String): MobileEvent? = prefs.getString("event_$eventId", null)?.let {
        runCatching { cacheJson.decodeFromString<MobileEvent>(it) }.getOrNull()
    }

    fun pending(): MobileEvent? = prefs.getString("pending_event_id", null)?.let(::get)

    fun remove(eventId: String) {
        val edit = prefs.edit().remove("event_$eventId")
        if (prefs.getString("pending_event_id", null) == eventId) edit.remove("pending_event_id")
        edit.apply()
    }
}
