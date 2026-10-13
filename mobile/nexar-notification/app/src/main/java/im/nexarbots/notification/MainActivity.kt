package im.nexarbots.notification

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

private val NexarGreen = Color(0xFF72F29B)
private val NexarSurface = Color(0xFF121C18)
private val NexarBackground = Color(0xFF0B1210)
private val NexarText = Color(0xFFF1F8F3)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        setContent { NexarTheme { NexarNotificationApp(eventIdFromIntent(intent)) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        setContent { NexarTheme { NexarNotificationApp(eventIdFromIntent(intent)) } }
    }

    private fun eventIdFromIntent(intent: Intent?) = if (intent?.action == ACTION_OPEN_EVENT) intent.getStringExtra(EXTRA_EVENT_ID) else null
}

@Composable
private fun NexarTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = NexarGreen, background = NexarBackground, surface = NexarSurface, onBackground = NexarText, onSurface = NexarText), content = content)
}

@Composable
private fun NexarNotificationApp(requestedEventId: String?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val credentialsStore = remember { CredentialStore(context) }
    val cache = remember { EventCache(context) }
    var credentials by remember { mutableStateOf(credentialsStore.get()) }
    var event by remember { mutableStateOf<MobileEvent?>(requestedEventId?.let(cache::get) ?: cache.pending()) }
    var reminders by remember { mutableStateOf(emptyList<AutomationReminder>()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    LaunchedEffect(requestedEventId, credentials) {
        val id = requestedEventId ?: return@LaunchedEffect
        event = cache.get(id)
        if (event == null && credentials != null) runCatching { NexarApi().event(credentials!!, id) }.onSuccess { loaded -> cache.save(loaded); event = loaded }
    }
    LaunchedEffect(credentials?.deviceId) {
        val current = credentials ?: return@LaunchedEffect
        runCatching { NexarApi().reminders(current) }.onSuccess { reminders = it }
    }
    val removeReminder: (String) -> Unit = { reminderId ->
        scope.launch {
            val current = credentials ?: return@launch
            runCatching { NexarApi().deleteReminder(current, reminderId) }
                .onSuccess {
                    reminders = reminders.filterNot { it.id == reminderId }
                    event = event?.let { currentEvent ->
                        currentEvent.copy(payload = currentEvent.payload.copy(reminders = currentEvent.payload.reminders.filterNot { it.id == reminderId }))
                            .also { cache.save(it) }
                    }
                }
                .onFailure { error = it.message ?: "Erinnerung konnte nicht gelöscht werden" }
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = NexarBackground) {
        AnimatedContent(targetState = event != null, label = "screen") { hasEvent ->
            if (hasEvent) NotificationScreen(event = event!!, onDeleteReminder = removeReminder, onClose = {
                val closingEvent = event ?: return@NotificationScreen
                scope.launch {
                    credentials?.let { runCatching { NexarApi().dismiss(it, closingEvent.id) } }
                    context.getSystemService(NotificationManager::class.java).cancel(closingEvent.id.hashCode())
                    cache.remove(closingEvent.id); event = null
                }
            }) else if (credentials == null) PairingScreen(onPaired = { paired -> credentialsStore.save(paired); credentials = paired; NotificationDelivery.schedulePolling(context) })
            else HomeScreen(
                busy = busy,
                error = error,
                reminders = reminders,
                onDeleteReminder = removeReminder,
                onRefresh = {
                    scope.launch {
                        busy = true; error = null
                        runCatching {
                            val api = NexarApi()
                            val nextReminders = api.reminders(credentials!!)
                            val nextEvents = api.pending(credentials!!)
                            reminders = nextReminders
                            nextEvents.reversed().forEach(cache::save)
                            event = nextEvents.firstOrNull() ?: cache.pending()
                        }.onFailure { error = it.message ?: "Keine Verbindung zur Nexar-Instanz" }
                        busy = false
                    }
                },
                onDisconnect = { credentialsStore.clear(); credentials = null; event = null },
            )
        }
    }
}

@Composable
private fun PairingScreen(onPaired: (DeviceCredentials) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var serverUrl by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("Android") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val installPrefs = remember { context.getSharedPreferences("nexar_installation", 0) }
    val installationId = remember { installPrefs.getString("id", null) ?: UUID.randomUUID().toString().also { installPrefs.edit().putString("id", it).apply() } }

    Column(modifier = Modifier.fillMaxSize().padding(28.dp), verticalArrangement = Arrangement.Center) {
        Icon(Icons.Outlined.Link, null, tint = NexarGreen, modifier = Modifier.size(38.dp))
        Spacer(Modifier.height(16.dp)); Text("Nexar verbinden", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Erstelle in Nexar Bots unter Automationen einen Kopplungscode und gib ihn hier ein.", color = Color(0xFFB5C3B9), modifier = Modifier.padding(top = 8.dp, bottom = 22.dp))
        OutlinedTextField(serverUrl, { serverUrl = it }, modifier = Modifier.fillMaxWidth(), label = { Text("HTTPS-Adresse deiner Nexar-Instanz") }, singleLine = true, placeholder = { Text("https://bots.example.de") })
        Spacer(Modifier.height(12.dp)); OutlinedTextField(code, { code = it.uppercase() }, modifier = Modifier.fillMaxWidth(), label = { Text("Kopplungscode") }, singleLine = true, placeholder = { Text("NB-ABCD-EFGH") })
        Spacer(Modifier.height(12.dp)); OutlinedTextField(name, { name = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Gerätename") }, singleLine = true)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
        Spacer(Modifier.height(20.dp)); Button(modifier = Modifier.fillMaxWidth(), enabled = !busy && serverUrl.startsWith("https://") && code.length >= 7, onClick = {
            scope.launch {
                busy = true; error = null
                val fcmToken = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
                runCatching { NexarApi().pair(serverUrl, code, installationId, name.ifBlank { "Android" }, fcmToken) }
                    .onSuccess(onPaired).onFailure { error = it.message ?: "Kopplung fehlgeschlagen" }
                busy = false
            }
        }) { if (busy) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Sicher koppeln") }
    }
}

@Composable
private fun HomeScreen(busy: Boolean, error: String?, reminders: List<AutomationReminder>, onDeleteReminder: (String) -> Unit, onRefresh: () -> Unit, onDisconnect: () -> Unit) {
    val context = LocalContext.current
    val notificationManager = context.getSystemService(NotificationManager::class.java)
    var remindersOpen by remember { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxSize().padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.NotificationsActive, null, tint = NexarGreen, modifier = Modifier.size(44.dp)); Spacer(Modifier.height(16.dp))
        Text("Bereit für Nexar-Bots", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Neue Automationsmeldungen erscheinen hier im Vollbild.", color = Color(0xFFB5C3B9), modifier = Modifier.padding(top = 8.dp))
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) OutlinedButton(onClick = { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }, modifier = Modifier.padding(top = 18.dp)) { Text("Benachrichtigungen erlauben") }
        if (Build.VERSION.SDK_INT >= 34 && !notificationManager.canUseFullScreenIntent()) OutlinedButton(onClick = { context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))) }, modifier = Modifier.padding(top = 18.dp)) { Text("Vollbild-Berechtigung aktivieren") }
        OutlinedButton(onClick = { remindersOpen = true }, modifier = Modifier.padding(top = 14.dp)) { Text("Erinnerungen · ${reminders.size}") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp)) }
        Spacer(Modifier.height(24.dp)); Button(onClick = onRefresh, enabled = !busy) { if (busy) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(8.dp)); Text("Jetzt synchronisieren") }
        OutlinedButton(onClick = onDisconnect, modifier = Modifier.padding(top = 10.dp)) { Text("Gerät trennen") }
    }
    if (remindersOpen) AlertDialog(
        onDismissRequest = { remindersOpen = false },
        title = { Text("Erinnerungen") },
        text = {
            if (reminders.isEmpty()) Text("Für dieses Gerät gibt es keine Erinnerungen.")
            else LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
                items(reminders, key = { it.id }) { reminder ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Text(reminder.content, color = NexarText)
                        Text(reminder.taskName, color = Color(0xFFB5C3B9), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
                        TextButton(onClick = { onDeleteReminder(reminder.id) }) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
                        HorizontalDivider(color = Color(0xFF2A3930))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { remindersOpen = false }) { Text("Fertig") } },
    )
}

@Composable
private fun NotificationScreen(event: MobileEvent, onDeleteReminder: (String) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(event.id) { CredentialStore(context).get()?.let { runCatching { NexarApi().seen(it, event.id) } } }
    val blocks = if (event.payload.blocks.isEmpty()) listOf(ContentBlock(type = "text", text = event.payload.summary)) else event.payload.blocks
    Column(modifier = Modifier.fillMaxSize().background(NexarBackground)) {
        LazyColumn(modifier = Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 22.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item { AnimatedVisibility(true, enter = fadeIn() + slideInVertically { -it / 3 }) { Column { Text(formatOccurredAt(event.payload.occurredAt, event.payload.timeZone), color = NexarGreen, style = MaterialTheme.typography.labelLarge, fontFamily = FontFamily.Monospace); Spacer(Modifier.height(8.dp)); Text(event.payload.title.ifBlank { event.title }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis); event.payload.source?.takeIf { it.botName.isNotBlank() }?.let { Text("${it.botName} · ${it.taskName}", color = Color(0xFFB5C3B9), modifier = Modifier.padding(top = 6.dp)) } } }
            item { HorizontalDivider(color = Color(0xFF2A3930), modifier = Modifier.padding(top = 6.dp)) }
            items(blocks) { block -> ContentBlockCard(block) }
            if (event.payload.widgets.isNotEmpty()) item { Text("WIDGETS", style = MaterialTheme.typography.labelMedium, color = NexarGreen, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(top = 8.dp)) }
            items(event.payload.widgets) { widget -> WidgetCard(widget) }
            if (event.payload.reminders.isNotEmpty()) item { Text("ERINNERUNGEN", style = MaterialTheme.typography.labelMedium, color = NexarGreen, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(top = 8.dp)) }
            items(event.payload.reminders, key = { it.id }) { reminder ->
                Card(colors = CardDefaults.cardColors(containerColor = NexarSurface), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(reminder.content, color = NexarText, modifier = Modifier.weight(1f))
                        TextButton(onClick = { onDeleteReminder(reminder.id) }) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().padding(20.dp), colors = ButtonDefaults.buttonColors(containerColor = NexarGreen, contentColor = NexarBackground)) { Text("Schließen", fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun ContentBlockCard(block: ContentBlock) {
    when (block.type) {
        "heading" -> Text(block.text.orEmpty(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
        "list" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { block.items.forEach { Row { Text("•", color = NexarGreen, fontWeight = FontWeight.Bold); Spacer(Modifier.width(10.dp)); Text(it, color = NexarText) } } }
        "quote" -> Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF17251E)), shape = RoundedCornerShape(14.dp)) { Column(Modifier.padding(16.dp)) { Text("“${block.text.orEmpty()}”", fontStyle = androidx.compose.ui.text.font.FontStyle.Italic); block.attribution?.let { Text("— $it", color = NexarGreen, modifier = Modifier.padding(top = 8.dp)) } } }
        "metric" -> Card(colors = CardDefaults.cardColors(containerColor = NexarSurface), shape = RoundedCornerShape(14.dp)) { Column(Modifier.padding(16.dp)) { Text(block.label.orEmpty(), color = Color(0xFFB5C3B9)); Text(block.value.orEmpty(), style = MaterialTheme.typography.headlineSmall, color = NexarGreen, fontWeight = FontWeight.Bold); block.detail?.let { Text(it, color = Color(0xFFB5C3B9), modifier = Modifier.padding(top = 4.dp)) } } }
        "code" -> Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF101714)), shape = RoundedCornerShape(12.dp)) { Text(block.text.orEmpty(), fontFamily = FontFamily.Monospace, modifier = Modifier.padding(14.dp)) }
        else -> Text(block.text.orEmpty(), style = MaterialTheme.typography.bodyLarge, color = NexarText)
    }
}

@Composable
private fun WidgetCard(widget: NotificationWidget) {
    val context = LocalContext.current
    val data = widget.data
    Card(colors = CardDefaults.cardColors(containerColor = NexarSurface), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(widget.title, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(8.dp))
            when (widget.kind) {
                "metric" -> Text(data.string("value").ifBlank { data.string("label") }, style = MaterialTheme.typography.headlineSmall, color = NexarGreen, fontWeight = FontWeight.Bold)
                "progress" -> { Text(data.string("label").ifBlank { "Fortschritt" }, color = Color(0xFFB5C3B9)); Spacer(Modifier.height(8.dp)); LinearProgressIndicator(progress = { data.number("progress").coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth(), color = NexarGreen) }
                "checklist" -> data.arrayStrings("items").forEach { Row(Modifier.padding(vertical = 3.dp)) { Icon(Icons.Outlined.CheckCircle, null, tint = NexarGreen, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(it) } }
                "action" -> { val url = data.string("url"); Text(data.string("label").ifBlank { "Öffnen" }, color = NexarGreen, modifier = Modifier.clickable(enabled = url.startsWith("http")) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) }
                else -> Text(data.string("label").ifBlank { data.string("value") }.ifBlank { "Aktiv" }, color = NexarGreen)
            }
        }
    }
}

private fun kotlinx.serialization.json.JsonObject.string(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
private fun kotlinx.serialization.json.JsonObject.number(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull?.toFloatOrNull() ?: 0f
private fun kotlinx.serialization.json.JsonObject.arrayStrings(key: String) = (this[key] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()

private fun formatOccurredAt(iso: String, timeZone: String): String = runCatching {
    val zone = runCatching { ZoneId.of(timeZone.ifBlank { "Europe/Vienna" }) }.getOrElse { ZoneId.systemDefault() }
    DateTimeFormatter.ofPattern("EEEE, dd. MMMM yyyy · HH:mm").withZone(zone).format(Instant.parse(iso))
}.getOrElse { "${iso.ifBlank { "Zeitpunkt unbekannt" }} · Gerätezeit" }
