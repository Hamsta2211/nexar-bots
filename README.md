# Nexar Bots

Selbst gehostete Agenten-Plattform. Du bringst deine eigenen API-Keys mit (Groq Console und Google AI Studio), Nexar kümmert sich um Bots, Werkzeuge, Gedächtnis und Automationen, die 24/7 laufen.

## Funktionen

- **Mehrere Bots** mit eigenem Anbieter (Groq oder Gemini), Modell, System-Prompt, Temperatur und Farbe
- **Modell-Auswahl als Liste:** alle aktuellen Modelle live von Groq bzw. Google (mit Kontextgröße, Stabil/Vorschau, Suche, „neu“-Markierung). Die Liste aktualisiert sich automatisch (Server alle 30 Min., Oberfläche alle 2 Min. und beim Zurückkehren ins Fenster) und warnt, wenn ein Bot-Modell nicht mehr angeboten wird
- **Werkzeuge (Function Calling):** Datum & Zeit, Rechner, Webseiten lesen, Websuche (DuckDuckGo mit Wikipedia-Fallback), Gedächtnis
- **Chat** mit Verläufen, Markdown, sichtbaren Werkzeug-Aufrufen
- **Erinnerungs-Startseite:** Obsidian-artige Notizkarten als Hauptmenü; darunter ein Schnellchat. Eingaben werden als normale Chats in Supabase gespeichert.
- **Automationen:** Bots führen Aufträge nach Zeitplan aus (15 Min. bis wöchentlich), Ergebnis optional per Webhook an Discord, Slack oder eigene URL
- **Automation-Erinnerungen:** eigener Reiter **Erinnerungen** sowie ein Erinnerungen-Button an jeder Automation zum Anlegen/Löschen; Erinnerungen erscheinen in den Automationsergebnissen und können in der gekoppelten Android-App direkt gelöscht werden.
- **Nexar-Bots-Benachrichtigung:** eigener Automationskanal für Android mit sicherer Einmal-Kopplung, animierter Vollbildanzeige, immer sichtbarem Ausführungsdatum/-zeitpunkt, scrollbar langen Texten und schließbarer Anzeige. Der Bot liefert ein validiertes Layout mit Überschriften, Texten, Listen, Kennzahlen und wiederverwendbaren Widgets.
- **Dashboard** mit Läufen, Tokens, Fehlern und Uptime
- **BYOK:** Keys werden nur auf deinem Server gespeichert, Modell-Liste wird live von deinem Key geladen
- **Mein PC (SSH):** eigenen Ubuntu-PC verbinden, Live-Status (CPU, RAM, Disk), Web-Terminal, Bot-Werkzeug „Mein Linux-PC“ und Admin-Bot „Tux“
- **Anmeldung mit E-Mail + Passwort** (private Ein-Personen-Instanz): Gerät bleibt 7 Tage angemeldet (HttpOnly-Cookie), neue Geräte müssen sich anmelden, Geräteliste mit Abmelden, Passwort ändern, optionale Zwei-Faktor-Anmeldung (TOTP), Brute-Force-Sperre
- **Alle Daten in Supabase** (Postgres): von überall erreichbar, Server austauschbar. Geheimnisse (API-Keys, SSH-Schlüssel, 2FA) sind mit AES-256-GCM verschlüsselt

## API-Keys holen

| Anbieter      | Link                               | Format  |
| ------------- | ---------------------------------- | ------- |
| Groq          | https://console.groq.com/keys      | `gsk_…` |
| Google Gemini | https://aistudio.google.com/apikey | `AIza…` |

Beide sind über OpenAI-kompatible Endpunkte angebunden:

- Groq: `https://api.groq.com/openai/v1`
- Gemini: `https://generativelanguage.googleapis.com/v1beta/openai`

## Konfiguration (.env)

```
DATABASE_URL=postgresql://nexar_app.<projekt-ref>:<passwort>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres
APP_SECRET=<64 Hex-Zeichen, openssl rand -hex 32>
```

- `DATABASE_URL`: Verbindung über eine eigene DB-Rolle `nexar_app`, die nur die `nb_*`-Tabellen lesen/schreiben darf. Über die öffentliche Supabase-API (anon/publishable Key) sind die Tabellen gesperrt (RLS ohne Policies für anon/authenticated).
- `APP_SECRET`: verschlüsselt API-Keys, SSH-Schlüssel und 2FA-Geheimnis. Liegt nur auf dem Server. Geht er verloren, müssen Keys neu eingetragen werden. Nicht mit in Git committen.

Rolle-Passwort ändern (Supabase SQL-Editor): `alter role nexar_app with password '<neu>';` und `DATABASE_URL` anpassen.

## Lokal starten

```bash
npm ci
cp .env.example .env   # Werte eintragen
npm run dev            # http://localhost:5000
```

## Ubuntu-Desktop-App

Die Desktop-App ist eine schlanke native Electron-Hülle für dieselbe Render-Instanz. Deshalb nutzt sie automatisch dieselben Anmeldedaten, Chats, Erinnerungen und Supabase-Daten wie die Website.

```bash
npm ci
npm run desktop:linux
```

Danach liegen eine installierbare `.deb`-Datei und eine portable `.AppImage` unter `dist/`. Zum lokalen Testen der Webadresse: `NEXAR_APP_URL=https://nexar-bots.onrender.com npm run desktop:dev`.

Produktion ohne Docker:

```bash
npm ci && npm run build
NODE_ENV=production node dist/index.cjs   # liest .env
```

## Sicherheit der Anmeldung

- Passwort wird nur als scrypt-Hash gespeichert, Vergleich in konstanter Zeit
- Sitzungstoken: 256 Bit Zufall, in der DB nur als SHA-256-Hash, Cookie `HttpOnly`, `SameSite=Lax`, bei HTTPS `Secure`, feste Laufzeit 7 Tage
- Brute-Force-Schutz: max. 8 Fehlversuche pro IP in 15 Min., 10 pro Konto pro Stunde
- Optional 2FA per Authenticator-App (unter **Sicherheit**), dringend empfohlen wegen SSH-Zugriff auf den PC
- **HTTPS ist Pflicht** für den Zugriff von unterwegs: Caddy mit eigener Domain (siehe unten) oder Tailscale Serve

## 24/7 auf Oracle Cloud Always Free

1. Konto auf https://www.oracle.com/cloud/free/ anlegen, Home-Region **Frankfurt** wählen.
2. VM erstellen: Ubuntu 24.04, Shape `VM.Standard.A1.Flex` (2 OCPU / 12 GB) oder `VM.Standard.E2.1.Micro`.
3. In der Security List TCP 80 und 443 öffnen, dann auf der VM:
   ```bash
   sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
4. Projekt hochladen, `.env` (DATABASE_URL, APP_SECRET) daneben legen.
5. Domain per A-Record auf die VM-IP zeigen lassen und in `Caddyfile` eintragen. Dann:
   ```bash
   docker compose up -d --build
   ```
   Caddy holt automatisch ein HTTPS-Zertifikat. Nexar selbst lauscht nur auf 127.0.0.1.

Alle Daten liegen in Supabase. Backups: Supabase-Dashboard → Database → Backups.

Alternative ohne Docker: `nexar-bots.service` (systemd) liegt bei.

## Ubuntu-PC per SSH verbinden

1. Auf dem PC: `sudo apt install -y openssh-server && sudo systemctl enable --now ssh`
2. PC und Nexar-Server ins selbe private Netz bringen, am einfachsten mit Tailscale (gratis):
   `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up` (auf beiden Geräten, gleiches Konto).
   Läuft Nexar direkt auf dem PC, reicht `127.0.0.1`.
3. In Nexar unter **Mein PC**: Host (Tailscale-IP `100.x.x.x`), Benutzer eintragen, **Schlüsselpaar erzeugen**,
   den angezeigten `echo … >> ~/.ssh/authorized_keys`-Befehl auf dem PC ausführen, speichern, testen.
4. Optional für Bots, die sudo brauchen: gezielte Befehle in `/etc/sudoers.d/nexar` mit `NOPASSWD` freigeben.

Sicherheit: Host-Fingerabdruck wird beim ersten Verbinden gemerkt und danach geprüft. Der Sicherheitsmodus blockiert
zerstörerische Befehle (`rm -rf /`, `mkfs`, `dd of=/dev/…`, Neustart, `curl | sh`) bei Bot-Befehlen. Das interaktive
SSH-Terminal nutzt eine authentifizierte, kurzlebige WebSocket-Freigabe und eine PTY-Sitzung; dort laufen Befehle
direkt auf dem PC und werden nicht vom Sicherheitsmodus gefiltert. Bot-Befehle laufen weiterhin in eigenen,
nicht interaktiven SSH-Sitzungen mit Zeitlimit.

## Projektstruktur

```
client/src/pages     Übersicht, Bots, Chat, Automationen, API-Keys, Mein PC, Sicherheit
client/src/components/remote-terminal.tsx  xterm.js-Terminal für interaktive SSH-PTY-Sitzungen
server/agent.ts      Provider-Anbindung, Werkzeuge, Agenten-Schleife
server/ssh.ts        SSH-Verbindung, Sicherheitsmodus, Systeminfo, PTY-Shell
server/terminal.ts   authentifizierte Terminal-Tickets und WebSocket-PTY-Bridge
server/models.ts     Live-Modellkatalog (Groq + Gemini), Cache, Auto-Aktualisierung
server/routes.ts     REST-API, Scheduler, Webhooks, Passwortschutz
server/storage.ts    SQLite-Tabellen und Datenzugriff
shared/schema.ts     Datenmodell und Validierung
```

## Android-Handy über KDE Connect

Das Werkzeug **Mein Handy** kann pro Agent aktiviert werden. Es ruft eine kleine, abgesicherte Bridge auf dem Rechner auf, der bereits mit dem Samsung-Handy über KDE Connect gekoppelt ist. Render kann nicht direkt auf ein privates WLAN-Gerät zugreifen; deshalb muss die Bridge über eine private, erreichbare Verbindung (z.B. Tailscale) veröffentlicht werden.

Die Bridge stellt diese POST-Routen bereit:

- `/api/kde-connect/notifications` – Benachrichtigungen abholen; die Agenten entscheiden selbst, was sie sinnvoll zusammenfassen und vorlesen.
- `/api/kde-connect/music_pause` und `/music_play` – Mediensteuerung.
- `/api/kde-connect/call_prepare` und `/call` – Anruf vorbereiten bzw. nach ausdrücklicher Nutzerbestätigung starten.
- `/api/kde-connect/call_answer` und `/call_reject` – eingehende Anrufe bedienen.
- `/api/kde-connect/mute_contact` – Kontakt zeitweise stummschalten.

Die Bridge muss `Authorization: Bearer <KDE_CONNECT_BRIDGE_TOKEN>` prüfen und darf nur bekannte KDE-Connect-Geräte ansprechen. Auf Render werden `KDE_CONNECT_BRIDGE_URL` und `KDE_CONNECT_BRIDGE_TOKEN` als Secret Environment Variables hinterlegt. Ohne diese Variablen bleibt das Werkzeug bewusst deaktiviert und gibt keine falsche Erfolgsmeldung aus.

Für Voice-Chat-Integrationen sollte die Bridge beim Beginn einer Agenten-Antwort `music_pause` und danach bei Ende `music_play` ausführen. Eingehende Benachrichtigungen können während einer aktiven Voice-Session gesammelt, serverseitig an den Agenten übergeben und als kurze, priorisierte Zusammenfassung vorgelesen werden. Ausgehende Anrufe werden im Agentenwerkzeug ohne `confirmed=true` niemals ausgeführt.

## Nexar-Bots-Benachrichtigung für Android

In **Automationen** ist unter **Ziel** der Punkt **Nexar-Bots-Benachrichtigung** verfügbar. Dort wird ein kurzlebiger Kopplungscode erstellt und in der nativen Android-App unter `mobile/nexar-notification` zusammen mit der HTTPS-Adresse dieser Nexar-Instanz eingegeben. Die App erhält danach einen eigenen, nur gehasht gespeicherten Gerätezugang.

Bei jedem Lauf übergibt Nexar alle zu dieser Automation gespeicherten Widgets in den Laufzeit-Systemprompt des Bots. Der Bot kann Widgets mit stabilen Schlüsseln anlegen, aktualisieren oder entfernen. Server und App prüfen das JSON-Format defensiv; bei nicht strukturiertem Text werden Überschriften, Listen, Zitate und Kennzahlen automatisch erkannt. Ereignisse und Widget-Snapshots liegen in Supabase, sodass die App auch nach einer späteren Entsperrung noch die vollständige Anzeige zeigt.

Für Push-Zustellung wird in Android Studio eine Firebase-Datei `mobile/nexar-notification/app/google-services.json` sowie auf Render das Secret `FIREBASE_SERVICE_ACCOUNT_JSON` benötigt. Ohne Firebase bleibt die manuelle und 15-minütige Hintergrund-Synchronisierung aktiv. Details zum Protokoll und Sicherheitsmodell: [`docs/nexar-bots-benachrichtigung.md`](docs/nexar-bots-benachrichtigung.md).
