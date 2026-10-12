package im.nexarbots.notification

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

const val ACTION_OPEN_EVENT = "im.nexarbots.notification.OPEN_EVENT"
const val EXTRA_EVENT_ID = "event_id"
private const val CHANNEL_ID = "nexar-alerts"
private const val POLL_WORK = "nexar-notification-poll"
private const val EVENT_WORK = "nexar-notification-event"

object NotificationDelivery {
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_HIGH).apply {
            description = context.getString(R.string.notification_channel_description)
            enableVibration(true)
            setShowBadge(true)
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun schedulePolling(context: Context) {
        val request = PeriodicWorkRequestBuilder<PollWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(POLL_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun syncEvent(context: Context, eventId: String) {
        val request = androidx.work.OneTimeWorkRequestBuilder<EventSyncWorker>()
            .setInputData(workDataOf(EXTRA_EVENT_ID to eventId)).build()
        WorkManager.getInstance(context).enqueueUniqueWork("$EVENT_WORK-$eventId", ExistingWorkPolicy.REPLACE, request)
    }

    fun presentOrQueue(context: Context, event: MobileEvent) {
        EventCache(context).save(event)
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (power.isInteractive && !keyguard.isKeyguardLocked) {
            context.startActivity(Intent(context, MainActivity::class.java)
                .setAction(ACTION_OPEN_EVENT).putExtra(EXTRA_EVENT_ID, event.id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        }
        postFallback(context, event)
    }

    private fun postFallback(context: Context, event: MobileEvent) {
        ensureChannel(context)
        val intent = Intent(context, MainActivity::class.java).setAction(ACTION_OPEN_EVENT).putExtra(EXTRA_EVENT_ID, event.id)
        val pending = PendingIntent.getActivity(context, event.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val manager = context.getSystemService(NotificationManager::class.java)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_nexar)
            .setContentTitle(event.title)
            .setContentText(event.payload.summary.ifBlank { "Neue Nexar-Bots-Benachrichtigung" })
            .setStyle(NotificationCompat.BigTextStyle().bigText(event.payload.summary))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(false)
            .setContentIntent(pending)
            .build()
        manager.notify(event.id.hashCode(), notification)
    }
}

class PollWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runCatching {
        val store = CredentialStore(applicationContext)
        val credentials = store.get() ?: return Result.success()
        val api = NexarApi()
        store.pendingFcmToken()?.let { token -> api.heartbeat(credentials, token); store.clearPendingFcmToken() }
        val events = api.pending(credentials)
        events.reversed().forEach { NotificationDelivery.presentOrQueue(applicationContext, it) }
        Result.success()
    }.getOrElse { Result.retry() }
}

class EventSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runCatching {
        val eventId = inputData.getString(EXTRA_EVENT_ID) ?: return Result.failure()
        val credentials = CredentialStore(applicationContext).get() ?: return Result.failure()
        NotificationDelivery.presentOrQueue(applicationContext, NexarApi().event(credentials, eventId))
        Result.success()
    }.getOrElse { Result.retry() }
}
