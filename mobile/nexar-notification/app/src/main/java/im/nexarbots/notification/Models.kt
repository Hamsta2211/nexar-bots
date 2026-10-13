package im.nexarbots.notification

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class MobileEvent(
    val id: String,
    val title: String,
    val payload: NotificationPayload,
    val createdAt: Long,
    val seenAt: Long? = null,
    val dismissedAt: Long? = null,
)

@Serializable
data class NotificationPayload(
    val version: Int = 1,
    val title: String = "Nexar-Bots",
    val summary: String = "",
    val blocks: List<ContentBlock> = emptyList(),
    val widgets: List<NotificationWidget> = emptyList(),
    val reminders: List<AutomationReminder> = emptyList(),
    val occurredAt: String = "",
    val timeZone: String = "Europe/Vienna",
    val source: SourceInfo? = null,
)

@Serializable
data class SourceInfo(val taskName: String = "", val botName: String = "")

@Serializable
data class ContentBlock(
    val type: String,
    val text: String? = null,
    val attribution: String? = null,
    val items: List<String> = emptyList(),
    val label: String? = null,
    val value: String? = null,
    val detail: String? = null,
    val language: String? = null,
)

@Serializable
data class NotificationWidget(
    val key: String,
    val kind: String,
    val title: String,
    val data: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class PairResponse(val device: PairedDevice, val deviceToken: String)

@Serializable
data class PairedDevice(val id: String, val displayName: String)

@Serializable
data class EventsResponse(val events: List<MobileEvent> = emptyList())

@Serializable
data class EventResponse(val event: MobileEvent)

data class DeviceCredentials(
    val baseUrl: String,
    val deviceId: String,
    val deviceToken: String,
)

@Serializable
data class AutomationReminder(
    val id: String,
    val content: String,
    val taskId: Long = 0,
    val taskName: String = "",
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

@Serializable
data class RemindersResponse(val reminders: List<AutomationReminder> = emptyList())
