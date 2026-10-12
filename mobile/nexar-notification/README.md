# Nexar-Bots-Benachrichtigung für Android

Native Kotlin/Jetpack-Compose-App für formatierte Nexar-Bots-Automationen.

## Einrichten

1. In Firebase ein Android-Projekt mit Paketname `im.nexarbots.notification` anlegen.
2. `google-services.json` in `app/google-services.json` ablegen. Die Datei enthält Projektkennung und bleibt lokal; sie wird nicht eingecheckt.
3. Mit Android Studio öffnen und auf einem Gerät mit Android 8+ ausführen.
4. In Nexar Bots unter **Automationen** als Ziel **Nexar-Bots-Benachrichtigung** wählen, **Android-App koppeln** anklicken und den dort erzeugten Code gemeinsam mit der HTTPS-Adresse der Nexar-Instanz in die App eintragen.

Auf dem Nexar/Render-Server muss zusätzlich das zugehörige Service-Account-JSON als Secret `FIREBASE_SERVICE_ACCOUNT_JSON` gesetzt werden. Ohne Firebase-Datei oder Server-Secret lässt sich die App weiterhin entwickeln und über die Schaltfläche aktualisieren; für Push-Zustellung im Hintergrund ist Firebase Cloud Messaging erforderlich.

## Android-Verhalten

- FCM-Pushes enthalten nur die Ereignis-ID; die App lädt Inhalt über ihren Gerätezugang nach.
- Ereignisse werden lokal gepuffert und beim App-Start, nach Rückkehr in den Vordergrund sowie über WorkManager synchronisiert.
- Bei gesperrtem/ausgeschaltetem Display wird ein Ereignis für `ACTION_USER_PRESENT` vorgemerkt und beim nächsten Entsperren geöffnet. Android kann Hintergrund-Activity-Starts je nach Version begrenzen; zusätzlich bleibt deshalb eine hochpriorisierte Systembenachrichtigung als zuverlässiger, Android-konformer Fallback erhalten.
- Für Vollbildanzeige und Benachrichtigungen müssen die entsprechenden Android-Berechtigungen erlaubt sein. Android-Versionen mit Einschränkungen für Full-Screen-Intents können diese in den Systemeinstellungen begrenzen.
