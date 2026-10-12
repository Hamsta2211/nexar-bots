package im.nexarbots.notification

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class NexarApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationDelivery.ensureChannel(this)
        NotificationDelivery.schedulePolling(this)
    }
}

class UserPresentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_USER_PRESENT) return
        val event = EventCache(context).pending() ?: return
        context.startActivity(Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN_EVENT).putExtra(EXTRA_EVENT_ID, event.id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) NotificationDelivery.schedulePolling(context)
    }
}

class NexarFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        message.data["eventId"]?.let { NotificationDelivery.syncEvent(applicationContext, it) }
    }

    override fun onNewToken(token: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val store = CredentialStore(applicationContext)
            store.savePendingFcmToken(token)
            store.get()?.let { credentials ->
                runCatching { NexarApi().heartbeat(credentials, token) }.onSuccess { store.clearPendingFcmToken() }
            }
        }
    }
}
