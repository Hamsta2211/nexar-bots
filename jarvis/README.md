# Jarvis Voice – Linux, Windows und Android

Jarvis bringt die **Original-Weboberflächen** von ChatGPT, Claude und Gemini auf deinen PC. Es ersetzt sie nicht durch eine nachgebaute Animation und verwendet für diese Chats keine separaten API-Konten. Die Jarvis-Sprachsteuerung, Wetteranzeige, System-Mediensteuerung und Supabase-Kontenanmeldung sind davon getrennt.

**Version 0.2.0 ist eine testbare Vorabversion.** Anbieter-Voice ist erst nutzbar, wenn du dich in ihrem Fenster angemeldet hast und dein Konto die Funktion anbietet. Der automatische Start sucht den tatsächlichen Voice-Knopf. Fehlt er, zeigt Jarvis eine Meldung statt einen erfolgreichen Voice-Chat zu behaupten. Ein vollständiger Test mit deinen Konten, deinem Mikrofon und deinen Lautsprechern steht noch aus.

## Auf Ubuntu starten

Am einfachsten das `.deb`-Paket installieren:

```bash
sudo apt install ./Jarvis-Voice-0.2.0-linux-amd64.deb
```

Danach **Jarvis Voice** im Anwendungsmenü öffnen. Das Paket bringt Python, die Sprachbibliotheken und das deutsche Offline-Erkennungsmodell mit. Die Paketverwaltung installiert auch `playerctl` und `pulseaudio-utils` für System-Mediensteuerung.

Alternativ die AppImage-Datei verwenden:

```bash
chmod +x Jarvis-Voice-0.2.0-linux-x86_64.AppImage
./Jarvis-Voice-0.2.0-linux-x86_64.AppImage
```

Falls Ubuntu FUSE 2 benötigt: Unter Ubuntu 24.04 heißt das Paket `libfuse2t64`, auf älteren Versionen meist `libfuse2`. Alternativ lässt sich das AppImage mit `--appimage-extract` entpacken und über `squashfs-root/AppRun` starten. Falls in der AppImage-Variante Mediensteuerung oder Lautstärke fehlen, `sudo apt install playerctl pulseaudio-utils` installieren.

Die App nicht mit `sudo` und nicht routinemäßig mit `--no-sandbox` starten. In eingeschränkten Testumgebungen kann das nötig sein; auf deinem normalen PC sollen die Chromium-Schutzfunktionen eingeschaltet bleiben.

## Auf Windows und Android starten

Die Windows-`.exe` ist ein **nicht codesignierter x64-Installer**. Windows kann deshalb eine Warnung für einen unbekannten Herausgeber anzeigen. Eine eigene Python-Installation ist nicht nötig. Die System-Medientasten werden über Windows gesendet. Die Datei wurde unter Linux erzeugt; ein realer Windows-Audiotest ist noch offen.

Die Android-`.apk` ist eine **debug-signierte Vorabversion** für Android 8 oder neuer. Sie ist nicht als Play-Store-Veröffentlichung gedacht. Das Telefon öffnet die offiziellen Anbieter-Apps, wenn sie installiert sind, sonst deren Webseiten. Android erlaubt Jarvis nicht, fremde Voice-Sitzungen ohne deren Unterstützung heimlich zu starten oder zu beenden. Daher ist die Android-Version ein Companion und kein identischer Ersatz für die PC-Voice-Steuerung.

## Mikrofon und Sprachbefehle

Beim ersten Start beginnt die PC-App mit lokaler Wake-Wort-Erkennung. Das Mikrofon ist im Fenster deutlich markiert und kann jederzeit über **Mikrofon ausschalten** abgeschaltet werden. In **Einstellungen** lässt sich ein bestimmtes Eingabegerät auswählen. Deine Auswahl zum Ein-/Ausschalten bleibt lokal gespeichert; eine Cloud-Synchronisation schaltet ein ausgeschaltetes PC-Mikrofon nicht aus der Ferne ein.

- **„ChatGPT“**, **„Claude“** oder **„Gemini“** öffnet das jeweilige Originalfenster und versucht, dessen Voice-Modus direkt zu starten.
- **„ChatGPT abbrechen“**, **„Claude abbrechen“** oder **„Gemini abbrechen“** schließt das entsprechende PC-Anbieterfenster vollständig. Dadurch werden dessen Audioverbindung und Mikrofonzugriff beendet. Die lokale Wake-Erkennung bleibt an, sofern du sie nicht abschaltest.
- **„Jarvis, nächstes Lied“**, **„Jarvis, vorheriges Lied“**, **„Jarvis, Pause“**, **„Jarvis, lauter“**, **„Jarvis, leiser“** und **„Jarvis, stumm“** bedienen die System-Mediensteuerung. Es besteht keine Verbindung zu YouTube Music.
- **„Jarvis, wie ist das Wetter in Wien?“** ruft aktuelle Open-Meteo-Daten ab und liest sie vor.

Die Wake-Wörter werden mit **Vosk lokal** erkannt. Im Anbieter-Voice-Chat gelten die Mikrofon- und Datenregeln des jeweiligen Anbieters. Umgebungsgeräusche, Akzent und die Ausgabe aus Lautsprechern können die Erkennung beeinflussen; Kopfhörer können Übersprechen reduzieren. Die Befehlserkennung wurde mit gesprochenen Testaufnahmen geprüft, nicht mit deiner physischen Hardware.

## Deine echten Voice-Chats

Jeder Anbieter hat einen eigenen persistenten Browserbereich. Melde dich darin einmal bei deinem eigenen Konto an. Passwörter werden nicht durch Jarvis abgefragt oder zwischen Geräten kopiert. Die Oberfläche im großen rechten Bereich gehört dem Anbieter; sie sieht deshalb so aus, wie dessen Webversion, nicht zwingend wie die Handy-App.

**ChatGPT und Claude:** Voice ist offiziell auch im Web beschrieben. Der automatische Knopfdruck ist von Beschriftungen und Änderungen der Anbieteroberfläche abhängig. Erste Einrichtung, Sprachauswahl oder Konto-Prüfungen können einen manuellen Klick erfordern. Bei Problemen lässt sich das Fenster neu laden oder beenden.

**Gemini:** Jarvis öffnet die echte Gemini-Seite und startet Live nur, wenn ein entsprechender Knopf verfügbar ist. Die dokumentierte Desktop-Variante von Gemini Live ist an unterstütztes **Gemini in Chrome** gebunden und nicht automatisch in Electron oder unter Ubuntu verfügbar. Eine offizielle Gemini-Live-Sitzung unter Linux wird daher nicht garantiert. Es gibt absichtlich keinen versteckten API-Voice-Ersatz.

Quellen: [ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice), [Claude Voice](https://support.claude.com/en/articles/11101966-use-voice-mode), [Gemini Live in Chrome](https://support.google.com/gemini/answer/16363185?hl=en).

## Conrad und alle Microsoft-Stimmen

Jarvis verwendet die Python-Bibliothek **edge-tts** für den Microsoft-Edge-Onlinedienst. Das ist eine freie Bibliothek für den Microsoft-Dienst, **kein offizielles Microsoft-SDK**. Standard ist `de-DE-ConradNeural`.

Unter **Einstellungen → Alle Stimmen laden** wird die aktuell verfügbare Liste abgerufen. Nach Name, Land, Sprache oder Geschlecht suchen, eine Stimme anhören und übernehmen. Im Test waren 322 Stimmen verfügbar, darunter Conrad. Der Dienst benötigt Internet und kann seine Verfügbarkeit ändern. Die Stimme betrifft Jarvis selbst; die Stimmen von ChatGPT, Claude und Gemini werden in deren eigenen Einstellungen ausgewählt.

Bibliothek: [rany2/edge-tts](https://github.com/rany2/edge-tts). Offline-Erkennung: [Vosk](https://alphacephei.com/vosk/).

## Ein Konto auf allen drei Plattformen

Unter **Konto & Geräte** bzw. **Cloud-Anmeldung** mit E-Mail und Passwort registrieren oder anmelden. Supabase verlangt im vorhandenen Projekt eine E-Mail-Bestätigung. Nach dem Bestätigen in jeder App mit denselben Zugangsdaten anmelden.

Das Konto synchronisiert Stimme, Wetterort und Anzeigeeinstellungen. Die Profiltabelle hat Row Level Security: Zugriff ist nur für den eigenen Kontoinhaber erlaubt. **Keine Anbieter-Passwörter, Browser-Cookies, laufenden Gespräche oder fremden Chatverläufe werden synchronisiert.** Die Anbieter synchronisieren ihre Chatverläufe selbst über das jeweilige Konto. Gleichzeitige Änderungen werden nach dem zuletzt geschriebenen Stand übernommen.

Desktop-Sitzungen werden nur dann dauerhaft durch Jarvis gespeichert, wenn ein geeigneter Betriebssystem-Schlüsselbund zur Verfügung steht. Andernfalls bleibt die Sitzung für die laufende App im Speicher. Android speichert Tokens im privaten App-Bereich; Backups sind deaktiviert.

**GitHub-Anmeldung ist vorbereitet, aber im vorhandenen Supabase-Projekt noch nicht aktiviert.** Sie braucht eine von dir verwaltete GitHub-OAuth-App sowie deren Client-ID und Client-Secret in Supabase. Diese Daten sind keine öffentlichen App-Schlüssel und werden nicht in die App eingebaut. Die genaue Einrichtung steht in [cloud/README.md](cloud/README.md). Es wurde keine GitHub-App registriert und keine funktionierende GitHub-Anmeldung vorgetäuscht.

## Android mit dem PC koppeln

Für eine direkte Fernbedienung der PC-Mediensteuerung:

1. Am PC **Konto & Geräte → Kopplung aktivieren & Code erzeugen** wählen.
2. Falls die automatisch gewählte Adresse nicht passt, eine erreichbare private LAN- oder bereits vorhandene Tailscale-Adresse des PCs angeben.
3. Die Einladung in der Android-App unter **Desktop koppeln** einfügen. Sie ist fünf Minuten gültig und nur einmal nutzbar.
4. Beide Geräte müssen den PC auf Port `47831` erreichen können. Es wird kein öffentlicher Tunnel und keine Portweiterleitung eingerichtet.

Die Verbindung ist HTTPS-verschlüsselt und die Android-App prüft das Zertifikat gegen den Fingerabdruck in der Einladung. PC-Neustarts behalten dasselbe Zertifikat. Geräte lassen sich am PC einzeln trennen; **Kopplung ausschalten** beendet den lokalen Server. Die Einladung vertraulich behandeln, denn mit ihr kann ein Gerät Zugriff auf die Jarvis-Fernbedienung bekommen.

Ohne Kopplung bedient Android seine eigenen Medientasten und lädt Wetter direkt. Im Hintergrund wird kein dauerhafter Android-Abhördienst gestartet. Die Microsoft-Sprachausgabe wird vom PC erzeugt. Im gekoppelten Android-Companion lassen sich alle Stimmen durchsuchen und als Vorschau über den Telefonlautsprecher anhören; Android bringt keine eigene Python-Laufzeit für Conrad mit.

## Aus dem Quellcode bauen

```bash
cd jarvis
npm ci
python3 scripts/prepare-runtimes.py
npm test
npm run dist:linux
npm run dist:win
```

Das Runtime-Skript lädt die dokumentierten Python-Laufzeiten, das deutsche Vosk-Modell und die Python-Abhängigkeiten. Internet und genügend freier Speicher werden benötigt. Die öffentlichen Supabase-Projektwerte stehen in `resources/cloud.json`; weder ein Service-Role-Schlüssel noch private Zugangsdaten gehören hinein.

Android: `cd android`, Android-SDK in `local.properties` konfigurieren und `./gradlew assembleDebug` ausführen. JDK 17 und ein zu Gradle/Android-Plugin passendes SDK werden benötigt. `tests/desktop-smoke.cjs` benötigt eine grafische Sitzung oder Xvfb; `tests/voice-smoke.py --synthesize` erzeugt echte Conrad-Testaufnahmen und benötigt zusätzlich FFmpeg.

Die vorhandene Nexar-Bots-Anwendung bleibt unverändert. Jarvis enthält bewusst **keine Timer, Kalender oder Erinnerungen**.
