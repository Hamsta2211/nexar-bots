# Jarvis

Sprachsteuerung mit eigenen lokalen Modellen oder Groq, Conrad-Stimme, Wetter und System-Medientasten. Keine Timer, Kalender oder Erinnerungen. GitHub ist nur die Quellcode-Ablage, keine App-Anmeldung.

## Installieren

**Ubuntu/Linux x64:** `sudo apt install ./Jarvis-0.4.0-linux-amd64.deb`, danach „Jarvis“ öffnen. Alternativ die AppImage ausführbar machen und starten; dafür kann FUSE nötig sein. Python und das deutsche Offline-Spracherkennungsmodell sind enthalten.

**Windows x64:** `Jarvis-0.4.0-win-x64.exe` starten. Der Installer besitzt kein kommerzielles Windows-Code-Signing-Zertifikat; Windows kann eine Warnung anzeigen.

**Android 8+:** `Jarvis-0.4.0-android.apk` installieren. Dies ist eine signierte, nicht-debuggbare Release-App. Eine ältere Debug-APK mit anderer Signatur muss vorher deinstalliert werden. Dabei gehen lokale Einstellungen und Kopplungen verloren; Kontoeinstellungen vorher synchronisieren. Ein Update der gleich signierten 0.3.0 behält die App-Daten.

## Jarvis als KI verwenden

Unter **KI-Modell** zwischen **Lokal · Ollama** und **Groq** wählen.

**Lokal:** [Ollama](https://docs.ollama.com/quickstart) auf dem PC einrichten und ein passendes Modell installieren, beispielsweise mit `ollama pull llama3.2`. Standardadresse ist `http://127.0.0.1:11434`. „Verbinden & Modelle laden“ zeigt die wirklich installierten Modelle. Modell wählen und „Übernehmen“ anklicken. Die App lädt keine großen Modelle ohne Zutun herunter. Ein eigener Server im privaten Netz oder über HTTPS kann ebenfalls verwendet werden.

**Groq:** Den eigenen Groq-API-Schlüssel im Passwortfeld hinterlegen und mit „Verbinden & Modelle laden“ den verfügbaren Textmodell-Katalog abrufen. Gewünschtes Modell wählen und übernehmen. Groq-Anfragen unterliegen den Bedingungen und Kosten des eigenen Groq-Kontos. Der Schlüssel bleibt auf dem PC: verschlüsselt durch den System-Schlüsselbund oder, wenn dieser nicht verfügbar ist, ausdrücklich nur für die laufende Sitzung im Arbeitsspeicher. Keine Klartextablage und keine Cloud-Synchronisation von Schlüsseln. „Schlüssel löschen“ entfernt ihn wieder.

„**Jarvis, was ist zwei plus zwei?**“ stellt eine Frage. „**Jarvis**“ allein aktiviert die Unterhaltung; danach können weitere Fragen ohne erneutes Wake-Wort gesprochen werden. „**Jarvis abbrechen**“ beendet die Unterhaltung und stoppt auch eine laufende Sprachausgabe. Fragen können alternativ eingegeben werden. „Neues Gespräch“ verwirft den bisherigen Modell-Kontext. Dieser Kontext wird begrenzt im Arbeitsspeicher gehalten, nicht als Chatarchiv gespeichert oder in die Cloud übertragen. Gekoppelte Geräte verwenden dieselbe PC-Unterhaltung.

Die Frage und Antwort erscheinen auf dem Bildschirm. Die Standardstimme ist **Conrad**. Unter Einstellungen lassen sich die verfügbaren Microsoft-Stimmen durchsuchen und anhören. Die Ausgabe nutzt Python [`edge-tts`](https://github.com/rany2/edge-tts), eine Drittanbieter-Bibliothek, kein offizielles Microsoft-Python-SDK. **Auch bei lokalem KI-Modell benötigt die Conrad-Ausgabe Internet und übermittelt den Antworttext an den Microsoft-Sprachdienst.** Die Wake-/Befehlserkennung selbst läuft lokal. Groq erhält den Gesprächskontext für seine Antworten.

## Originale Voice-Chats, Medien und Wetter

„ChatGPT“, „Claude“ oder „Gemini“ öffnet das Originalfenster auf dem Desktop. Beim ersten Mal dort anmelden und die Voice-Ersteinrichtung des Anbieters abschließen. Jarvis versucht, den sichtbaren Voice-Einstieg zu wählen. „ChatGPT abbrechen“, „Claude abbrechen“ beziehungsweise „Gemini abbrechen“ schließt das Fenster samt Popups und Audioaufnahme. Anbieter-Logins werden nicht durch ein Jarvis-Konto ersetzt.

„Jarvis, nächstes Lied“, „Jarvis, vorheriger Titel“, „Jarvis, Pause“, „Jarvis, lauter“, „Jarvis, leiser“ oder „Jarvis, stumm“ steuert den Systemplayer: unter Linux über MPRIS/playerctl, unter Windows mit Windows-Medientasten. Kein Musikdienst-Konto und keine YouTube-Music-Anbindung nötig.

„Jarvis, wie ist das Wetter in Wien?“ lädt Open-Meteo-Daten mit Zeitstand. Bei Fehlern werden keine Werte erfunden.

## Geräte verbinden

Für gemeinsame Einstellungen dasselbe E-Mail/Passwort-Konto auf allen Geräten verwenden und gegebenenfalls die E-Mail bestätigen. Stimme, Wetterort, Anzeigeeinstellungen sowie KI-Anbieter und Modellnamen werden synchronisiert. **Nicht synchronisiert werden API-Schlüssel, Ollama-Adressen, Mikrofon-Gerätekennungen, Anbieter-Logins und Gespräche.** Ein anderes Gerät darf das lokale Mikrofon nicht unbemerkt einschalten. Für rein lokale PC-Nutzung ist kein Jarvis-Konto nötig.

Für Android unter Konto → Geräte am PC eine Einladung erzeugen und am Telefon einfügen. Beide Geräte müssen den PC in einem privaten Netz erreichen. Die Einladung gilt fünf Minuten und einmal. Die Verbindung ist HTTPS-verschlüsselt und an das PC-Zertifikat gebunden; Geräte lassen sich wieder trennen.

Android verwendet die Modelle und Microsoft-Stimmen des gekoppelten PCs. Das lokale Modell und der Groq-Schlüssel werden am PC eingerichtet; auf dem Telefon lassen sich Anbieter und Modell auswählen sowie Fragen stellen und abbrechen. Der PC muss dafür eingeschaltet und erreichbar sein. Android führt kein Ollama-Modell auf dem Telefon aus.

## Was noch nicht am persönlichen Gerät abgenommen ist

Der vollständige Betrieb mit deinen Anbieter-Konten und deinem Mikrofon/Lautsprecher ist noch nicht persönlich abgenommen: Der eigentliche Ubuntu-PC war aus dieser Sitzung nicht per SSH erreichbar; persönliche Anbieter-Sitzungen wurden nicht verwendet. Originalseiten können ihren Aufbau oder Login-Schutz ändern. Die App kann solche fremden Oberflächen nicht wie eine eigene API garantieren.

Google dokumentiert Gemini Live am Computer für Chromebook Plus, Mac und Windows in freigegebenen Regionen, nicht für Linux. Das Einbetten von gemini.google.com stellt diese Chrome-Funktion nicht bereit. Unter Linux öffnet Jarvis deshalb die Original-Webseite, keinen nachgebauten Live-Chat: [Live in Chrome](https://support.google.com/gemini/answer/16363185), [Verfügbarkeit](https://support.google.com/gemini/answer/17140089). ChatGPT und Claude dokumentieren Voice im Web: [ChatGPT](https://help.openai.com/en/articles/20001274-chatgpt-voice), [Claude](https://support.claude.com/en/articles/11101966-use-voice-mode).

Android öffnet die offiziellen Anbieter-Apps, kann deren geschützte Voice-Sitzungen aber nicht zuverlässig automatisch starten oder beenden. Keine vollständige Hintergrund-Wake-/Abbruch-Parität zum Desktop. Windows wird hier paketiert und die Windows-Python-Laufzeit unter Wine geprüft, nicht auf einem echten Windows-PC. Android wird gebaut und die Signatur sowie API-Logik geprüft, nicht auf einem echten Telefon. Ein Emulatorstart ließ sich in der Testumgebung nicht erfolgreich abschließen. Ein echter Groq-Aufruf ist ohne deinen API-Schlüssel noch nicht geprüft; die API-Verträge, Modelllisten, Fehler und Abbruchpfade werden mit kontrollierten Antworten getestet.

## Entwickeln und testen

```sh
npm ci
python3 scripts/prepare-runtimes.py
npm test
npm run test:providers
npm run test:desktop
node tests/media-integration.cjs
xvfb-run -a node tests/audio-e2e.cjs
bash tests/android-api-test.sh
npm run dist:all
```

Mit einem Ollama-Testserver und installiertem Modell sind zusätzlich `tests/brain-desktop.cjs`, `tests/brain-live-bridge.cjs` und `JARVIS_AUDIO_BRAIN=1 xvfb-run -a node tests/audio-e2e.cjs` ausführbar. Standard für diese Tests ist `http://127.0.0.1:18944`, Modell `qwen2.5:0.5b`; dieses kleine Modell dient dem Integrationstest, nicht als Empfehlung für Antwortqualität. Desktop-/Bridge-Tests lassen sich mit `JARVIS_OLLAMA_TEST_URL` und `JARVIS_OLLAMA_TEST_MODEL` konfigurieren. Der Audio-Test verwendet den genannten lokalen Testserver.

Linux-Integrationstests benötigen dbus-run-session, playerctl, PulseAudio/PipeWire-Werkzeuge, ffmpeg, Chromium/Xvfb und Python dbus-next. Der Audio-Test nutzt eigene virtuelle Geräte und synthetische Aufnahmen in `tests/fixtures/voice`; System-Standardgeräte werden nicht verändert. Der synthetische Monitor-Eingang wird ohne Echo- und Rauschfilter erfasst, damit diese Filter die eingesprochenen Testwörter nicht als Computer-Echo entfernen. In der App sind diese Filter weiterhin standardmäßig aktiv; die Abstimmung am echten Mikrofon und Lautsprecher bleibt ein Hardwaretest. Anbieter-HTML ist dabei eine Fixture: Diese Tests belegen Audioaufnahme, Erkennung, Befehle und Fenstersteuerung, keine angemeldeten Anbieter-Voice-Gespräche.

`cloud/schema.sql`, `cloud/atomic-settings.sql` und `cloud/brain-settings-migration.sql` enthalten RLS und atomare Einstellungs-Patches. Die entsprechenden Migrationen sind im konfigurierten Projekt angewendet. Kein Service-Role-Schlüssel ist enthalten. Ausstehende Änderungen bleiben für Wiederholungen lokal gespeichert; Geräte ändern einzelne Felder statt ganze Profile zu überschreiben.

Android-Build und private Signierkonfiguration: siehe `android/README.md`. Signierschlüssel gehören nicht ins Repository oder Quellarchiv.
