# Jarvis

Sprachsteuerung, Wetter und System-Medientasten. Keine Timer, Kalender oder Erinnerungen.

## Installieren

**Ubuntu/Linux x64:** `sudo apt install ./Jarvis-0.3.0-linux-amd64.deb`, danach „Jarvis“ öffnen. Alternativ die AppImage ausführbar machen und starten; dafür kann FUSE nötig sein. Python und das deutsche Sprachmodell sind enthalten.

**Windows x64:** `Jarvis-0.3.0-win-x64.exe` starten. Der Installer besitzt kein kommerzielles Windows-Code-Signing-Zertifikat; Windows kann eine Warnung anzeigen.

**Android 8+:** `Jarvis-0.3.0-android.apk` installieren. Die Datei ist eine signierte, nicht-debuggbare Release-App. Eine ältere Debug-APK mit anderer Signatur muss vor dem Wechsel deinstalliert werden. Dabei gehen lokale Einstellungen und Kopplungen verloren; Kontoeinstellungen vorher synchronisieren.

## Benutzen

„ChatGPT“, „Claude“ oder „Gemini“ öffnet das Originalfenster auf dem Desktop. Beim ersten Mal dort anmelden und die Voice-Ersteinrichtung des Anbieters abschließen. Jarvis versucht, den sichtbaren Voice-Einstieg zu wählen. „ChatGPT abbrechen“, „Claude abbrechen“ beziehungsweise „Gemini abbrechen“ schließt das Fenster samt Popups und Audioaufnahme.

„Jarvis, nächstes Lied“, „vorheriger Titel“, „Pause“, „lauter“, „leiser“ oder „stumm“ steuert den aktiven Systemplayer. Unter Linux über MPRIS/playerctl, unter Windows mit Windows-Medientasten. Es ist kein Musikdienst-Konto nötig.

„Jarvis, wie ist das Wetter in Wien?“ lädt Open-Meteo-Daten mit Zeitstand. Bei Fehlern werden keine Werte erfunden. Die Standardstimme ist Conrad. Unter Einstellungen lassen sich die verfügbaren Stimmen durchsuchen und anhören. Die Ausgabe nutzt Python `edge-tts` und braucht Internet; es handelt sich nicht um ein offizielles Microsoft-Python-SDK.

## Geräte verbinden

Für gemeinsame Einstellungen dasselbe E-Mail/Passwort-Konto auf allen Geräten verwenden. Die E-Mail gegebenenfalls bestätigen. Stimme, Wetterort und Anzeigeeinstellungen werden synchronisiert; Mikrofon-Gerätekennungen, Anbieter-Logins und laufende Gespräche nicht. Ein anderes Gerät darf das lokale Mikrofon nicht unbemerkt einschalten.

Für Android als PC-Fernbedienung unter Konto → Geräte am PC eine Einladung erzeugen und am Telefon einfügen. Beide Geräte müssen denselben PC in einem privaten Netz erreichen. Die Einladung gilt fünf Minuten und einmal. Die Verbindung ist HTTPS-verschlüsselt und an das PC-Zertifikat gebunden. Geräte lassen sich wieder trennen.

Für die lokale PC-Nutzung ist kein Jarvis-Konto nötig. GitHub ist keine App-Anmeldung.

## Grenzen und Abnahme

**Der vollständige Betrieb mit deinen Anbieter-Konten und deinem Mikrofon/Lautsprecher ist noch nicht abgenommen.** Der eigentliche Ubuntu-PC war aus dieser Sitzung nicht per SSH erreichbar; persönliche Anbieter-Sitzungen wurden nicht verwendet. Originalseiten können ihren Aufbau oder Login-Schutz ändern. Die App kann solche fremden Oberflächen nicht wie eine eigene API garantieren.

Google dokumentiert Gemini Live am Computer für Chromebook Plus, Mac und Windows in freigegebenen Regionen, nicht für Linux. Das Einbetten von gemini.google.com stellt diese Chrome-Funktion nicht bereit. Unter Linux öffnet Jarvis deshalb die Original-Webseite, keinen nachgebauten Live-Chat: [Live in Chrome](https://support.google.com/gemini/answer/16363185), [Verfügbarkeit](https://support.google.com/gemini/answer/17140089).

ChatGPT und Claude dokumentieren Voice im Web: [ChatGPT](https://help.openai.com/en/articles/20001274-chatgpt-voice), [Claude](https://support.claude.com/en/articles/11101966-use-voice-mode).

Android ist ein Companion für Medien, Wetter, Einstellungen und gekoppelte PC-Stimmen. Er öffnet die offiziellen Anbieter-Apps, kann deren geschützte Voice-Sitzungen aber nicht zuverlässig automatisch starten oder beenden. Keine vollständige Hintergrund-Wake-/Abbruch-Parität zum Desktop. Windows wird hier paketiert und die Windows-Python-Laufzeit unter Wine geprüft, nicht auf einem echten Windows-PC; Android wird gebaut und die Signatur geprüft, nicht auf einem echten Telefon.

## Entwickeln und testen

```sh
npm ci
python3 scripts/prepare-runtimes.py
npm test
npm run test:providers
npm run test:desktop
node tests/media-integration.cjs
xvfb-run -a node tests/audio-e2e.cjs
npm run dist:all
```

Linux-Integrationstests benötigen zusätzlich dbus-run-session, playerctl, PulseAudio/PipeWire-Werkzeuge, ffmpeg, Chromium/Xvfb und Python dbus-next. Der Audio-Test nutzt eigene virtuelle Geräte und synthetische Sprachaufnahmen in `tests/fixtures/voice`; keine System-Standardgeräte werden geändert. Anbieter-HTML in diesem Test ist eine Fixture: Der Test belegt Aufnahme, Offline-Erkennung, Befehle und Fenstersteuerung, **keine angemeldeten Online-Voice-Gespräche**.

`cloud/schema.sql` und `cloud/atomic-settings.sql` richten RLS und atomare Einstellungs-Patches ein. Im konfigurierten Projekt sind beide Migrationen angewendet. Kein Service-Role-Schlüssel ist enthalten. Ausstehende Änderungen bleiben für Wiederholungen lokal gespeichert; verschiedene Geräte ändern serverseitig einzelne Felder statt sich gegenseitig ganze Profile zu überschreiben.

Android-Build und private Signierkonfiguration: siehe `android/README.md`. Signierschlüssel gehören nicht ins Repository oder Quellarchiv.
