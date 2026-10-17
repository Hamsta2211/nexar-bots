# Jarvis Companion (Android)

Native Java APK ohne Compose/Kotlin-Dependencies. Debug-APK (debug-signiert): `app/build/outputs/apk/debug/app-debug.apk`.

## Cloud
Die App liest `app/src/main/assets/cloud.json` und verwendet Supabase REST direkt: E-Mail/Passwort-Registrierung, Login, Refresh-Token, `/auth/v1/user`, Logout und lokales Löschen. Eine vorhandene Session bleibt nach App-Neustart sichtbar; der Status zeigt nach erfolgreichem User-Read auch die E-Mail. Es wird kein Testkonto angelegt.

Das eigene `jarvis_profiles`-Profil wird RLS-sicher gelesen und per Upsert mit `updated_at` aktualisiert. `settingsDirty` wird ausschließlich beim Speichern im Einstellungen-Dialog gesetzt. Ohne lokale Änderung wird das Cloud-Profil vollständig übernommen; bei lokaler Änderung werden ausschließlich `voice` und `weatherCity` lokal überlagert. Andere zulässige Cloud-Felder wie `alwaysOnTop` und `wakeEnabled` bleiben erhalten. Neue Profile erhalten die Core-Defaults `de-DE-ConradNeural`, `Wien`, `alwaysOnTop=true`, `wakeEnabled=true`. Abmelden löscht Session und setzt Cloud-/Dirty-Marker zurück. Polling läuft auch ohne Desktop.

## Desktop-Kopplung und Wetter
Einladungen sind Base64url-JSON mit HTTPS-URL und SHA-256-Zertifikat-Pin. `/state` wird nur angewendet, wenn es ein `settings`-Objekt liefert; vorhandene boolesche Werte werden nie zwangszurückgesetzt. `/media` wird bei Kopplung an den Desktop delegiert, sonst nativ über Android gesteuert.

Wetter ist unabhängig vom Desktop: Die App fragt Open-Meteo-Geocoding und anschließend `current.temperature_2m` direkt ab. HTTP-, Geocoding- und Parserfehler werden als sichtbarer Fehlerstatus ausgegeben; ein fehlendes Temperaturfeld gilt nicht als Erfolg.

## Sprache und Provider
Die sichtbare Vordergrund-Spracherkennung prüft `SpeechRecognizer.isRecognitionAvailable`, fordert Mikrofonrechte korrekt an und wird in `onPause` per cancel/destroy freigegeben. Befehle werden normalisiert; `abbrechen` wird vor Provider-Matching behandelt und beendet nur die eigene Erkennung. Die App behauptet nicht, fremde Voice-Sitzungen beenden zu können, sondern zeigt: „Fremde Voice-Sitzung bitte in Original-App beenden“. Unterstützt sind Provider öffnen sowie `next`, `previous`, Lautstärke und Wetter. Android-Manifest-`queries` erlauben die offizielle App-Erkennung für ChatGPT, Claude und Gemini.

## Microsoft-Stimmen und Vorschau
Nach Desktop-Kopplung lädt der Button **„Alle Microsoft-Stimmen durchsuchen“** die Stimmen über `GET /voices`. Die Liste ist nach vollständigem `ShortName`, FriendlyName, Locale oder Gender durchsuchbar; die Auswahl schreibt den exakten `ShortName`, setzt `settingsDirty` und synchronisiert das Profil. Ohne Kopplung wird ausdrücklich **„Für Microsoft-Stimmen mit PC koppeln“** angezeigt. Die Vorschau sendet `Guten Tag. Ich bin Jarvis.` über `POST /speak`, spielt die Base64-MP3 aus einer temporären Datei in `getCacheDir()` ab und löscht sie nach Abschluss oder Fehler. Android-TTS wird dafür nicht verwendet.

Remote-Medienfehler werden über den optionalen `DesktopApi.media(String, MediaCallback)` sichtbar im Status angezeigt; der vorhandene lokale Android-Medienpfad bleibt für nicht gekoppelte Geräte erhalten. Konto und Wetter funktionieren weiterhin unabhängig von der Desktop-Kopplung.

## Test und Grenzen
Offline-Build: `./gradlew --offline assembleDebug`. Ohne Gerät/Cloud-Testkonto können Netzwerk- und UI-Integrationspfade nicht live ausgeführt werden; compile/offline build und statische Invariantenprüfung sind möglich. Keine Testkonten oder Secrets werden erstellt.
