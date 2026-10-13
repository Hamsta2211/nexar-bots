package im.nexarbots.notification

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class NexarApi {
    private val client = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    private fun endpoint(baseUrl: String, path: String) = baseUrl.trimEnd('/') + path

    private suspend fun call(request: Request): String = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body.string()
            if (!response.isSuccessful) throw IllegalStateException("${response.code}: ${body.ifBlank { "Netzwerkfehler" }}")
            body
        }
    }

    private fun authenticated(credentials: DeviceCredentials, path: String) = Request.Builder()
        .url(endpoint(credentials.baseUrl, path))
        .header("Authorization", "Bearer ${credentials.deviceToken}")
        .header("X-Nexar-Device-Id", credentials.deviceId)

    suspend fun pair(baseUrl: String, code: String, installationId: String, displayName: String, fcmPushToken: String?): DeviceCredentials {
        val data = buildJsonObject {
            put("code", code); put("installationId", installationId); put("displayName", displayName); put("platform", "android")
            fcmPushToken?.let { put("fcmPushToken", it) }
        }
        val result = json.decodeFromString<PairResponse>(call(Request.Builder()
            .url(endpoint(baseUrl, "/mobile/pair"))
            .post(json.encodeToString(data).toRequestBody(mediaType)).build()))
        return DeviceCredentials(baseUrl.trimEnd('/'), result.device.id, result.deviceToken)
    }

    suspend fun heartbeat(credentials: DeviceCredentials, fcmPushToken: String?) {
        val data = buildJsonObject { fcmPushToken?.let { put("fcmPushToken", it) } }
        call(authenticated(credentials, "/mobile/devices/${credentials.deviceId}/heartbeat")
            .post(json.encodeToString(data).toRequestBody(mediaType)).build())
    }

    suspend fun pending(credentials: DeviceCredentials): List<MobileEvent> = json.decodeFromString<EventsResponse>(call(
        authenticated(credentials, "/mobile/events?limit=20").get().build(),
    )).events

    suspend fun event(credentials: DeviceCredentials, eventId: String): MobileEvent = json.decodeFromString<EventResponse>(call(
        authenticated(credentials, "/mobile/events/$eventId").get().build(),
    )).event

    suspend fun reminders(credentials: DeviceCredentials): List<AutomationReminder> = json.decodeFromString<RemindersResponse>(call(
        authenticated(credentials, "/mobile/reminders").get().build(),
    )).reminders

    suspend fun deleteReminder(credentials: DeviceCredentials, reminderId: String) {
        call(authenticated(credentials, "/mobile/reminders/$reminderId").delete().build())
    }

    suspend fun seen(credentials: DeviceCredentials, eventId: String) {
        call(authenticated(credentials, "/mobile/events/$eventId/seen").post("{}".toRequestBody(mediaType)).build())
    }

    suspend fun dismiss(credentials: DeviceCredentials, eventId: String) {
        call(authenticated(credentials, "/mobile/events/$eventId/dismiss").post("{}".toRequestBody(mediaType)).build())
    }
}
