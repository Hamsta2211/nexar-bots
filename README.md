# Nexar Bots

Selbst gehostete Agenten-Plattform. Du bringst deine eigenen API-Keys mit (Groq Console und Google AI Studio), Nexar kümmert sich um Bots, Werkzeuge, Gedächtnis und Automationen, die 24/7 laufen.

## Funktionen

- **Mehrere Bots** mit eigenem Anbieter (Groq oder Gemini), Modell, System-Prompt, Temperatur und Farbe
- **Modell-Auswahl als Liste:** alle aktuellen Modelle live von Groq bzw. Google (mit Kontextgröße, Stabil/Vorschau, Suche, „neu“-Markierung). Die Liste aktualisiert sich automatisch (Server alle 30 Min., Oberfläche alle 2 Min. und beim Zurückkehren ins Fenster) und warnt, wenn ein Bot-Modell nicht mehr angeboten wird
- **Werkzeuge (Function Calling):** Datum & Zeit, Rechner, Webseiten lesen, Websuche (DuckDuckGo mit Wikipedia-Fallback), Gedächtnis
- **Chat** mit Verläufen, Markdown, sichtbaren Werkzeug-Aufrufen
- **Automationen:** Bots führen Aufträge nach Zeitplan aus (15 Min. bis wöchentlich), Ergebnis optional per Webhook an Discord, Slack oder eigene URL
- **Dashboard** mit Läufen, Tokens, Fehlern und Uptime
- **BYOK:** Keys werden nur auf deinem Server gespeichert, Modell-Liste wird live von deinem Key geladen
- **Mein PC (SSH):** eigenen Ubuntu-PC verbinden, Live-Status (CPU, RAM, Disk), Web-Terminal, Bot-Werkzeug „Mein Linux-PC“ und Admin-Bot „Tux“
- **Anmeldung mit E-Mail + Passwort** (private Ein-Personen-Instanz): Gerät bleibt 7 Tage angemeldet (HttpOnly-Cookie), neue Geräte müssen sich anmelden, Geräteliste mit Abmelden, Passwort ändern, optionale Zwei-Faktor-Anmeldung (TOTP), Brute-Force-Sperre
- **Alle Daten in Supabase** (Postgres): von überall erreichbar, Server austauschbar. Geheimnisse (API-Keys, SSH-Schlüssel, 2FA) sind mit AES-256-GCM verschlüsselt

## API-Keys holen

| Anbieter | Link | Format |
|---|---|---|
| Groq | https://console.groq.com/keys | `gsk_…` |
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
zerstörerische Befehle (`rm -rf /`, `mkfs`, `dd of=/dev/…`, Neustart, `curl | sh`). Jeder Befehl läuft in einer
eigenen, nicht interaktiven SSH-Sitzung mit Zeitlimit.

## Projektstruktur

```
client/src/pages     Übersicht, Bots, Chat, Automationen, API-Keys, Hosting
server/agent.ts      Provider-Anbindung, Werkzeuge, Agenten-Schleife
server/ssh.ts        SSH-Verbindung, Sicherheitsmodus, Systeminfo
server/models.ts     Live-Modellkatalog (Groq + Gemini), Cache, Auto-Aktualisierung
server/routes.ts     REST-API, Scheduler, Webhooks, Passwortschutz
server/storage.ts    SQLite-Tabellen und Datenzugriff
shared/schema.ts     Datenmodell und Validierung
```
