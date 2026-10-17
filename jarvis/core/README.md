# Jarvis Core

`service.cjs` exportiert ausschließlich:

```js
const { createService } = require('./service.cjs');
const service = await createService({ dataDir, resourceDir, onEvent });
const result = await service.invoke(action, payload);
await service.close();
```

`createService` ist asynchron, importiert Electron nicht und verwendet nur Node-Builtins plus `selfsigned` für den lokalen HTTPS-Server. Einstellungen und Token werden atomar mit Dateimodus `0600` gespeichert; niemals Cookies oder Account-Synchronisation.

## invoke-Aktionen

- `status` → `{platform, voiceReady, recognizerReady, sharing, port, devices, settings, python}`
- `settings:get` → vollständige lokale Einstellungen
- `settings:set` mit `{voice, weatherCity, alwaysOnTop, wakeEnabled, inputDeviceId}` → neue Einstellungen
- `weather({city})` → Open-Meteo-Geocoding und aktuelle Daten, Fehler werden unverändert sichtbar
- `voices` → Array `{ShortName,Locale,Gender,FriendlyName?}`
- `speak({text,voice})` → `{audio:<base64>,mime:"audio/mpeg"}`
- `recognizer:pcm({audio:<base64 PCM16 16 kHz>})` → `{text,partial}`; `recognizer:reset`
- `media({action})` → `playpause`, `next`, `previous`, `stop`, `volumeup`, `volumedown`, `mute`
- `pairing:enable({host?})`, `pairing:disable`, `pairing:invite` → base64url-kodierte JSON-Einladung `{version:1,url,fingerprint,secret}`
- `brain:status`, `brain:configure({provider,localModel,groqModel})`, `brain:models({provider?})`, `brain:ask({text})`, `brain:cancel`, `brain:reset` → werden an das optionale `brainInvoke` aus `createService` delegiert. Ohne diese Injection ist die Fehlermeldung `Jarvis-Modelle nicht eingerichtet`.

`brain:configure` akzeptiert ausschließlich `provider`, `localModel` und `groqModel`; API-Schlüssel und Endpoint-Änderungen gehören nicht zum Vertrag und werden nie synchronisiert.

## Android-Vertrag

`pairing:enable` bindet explizit HTTPS auf `0.0.0.0:47831`. `POST /pair` akzeptiert `{secret,name}` (einmalig, 5 Minuten, 16 KiB, Rate-Limit) und liefert `{token,deviceId,state}`. Danach ist `Authorization: Bearer <token>` erforderlich. `GET/PUT /state` synchronisiert nur `voice`, `weatherCity`, `alwaysOnTop`, `wakeEnabled`; `GET /devices`, `DELETE /devices/:id`, `POST /media` und `GET /weather?city=...` sind authentifiziert. `GET /health` ist öffentlich und enthält keine Geheimnisse. Token werden ausschließlich gehasht gespeichert; Geräte lassen sich widerrufen. Der Companion muss das Einladung-Zertifikat per SHA-256-Fingerprint pinnen.

## Brain-HTTPS-Vertrag

`GET /brain` liefert den öffentlichen Brain-Status ohne Geheimnisse (kein API-Key); alle übrigen Brain-Endpunkte sind wie die bestehenden Android-Routen per Bearer-Token geschützt:

- `GET /brain/models?provider=local|groq`
- `POST /brain/ask` mit `{text}` (UTF-8 maximal 8.000 Bytes; die Anfrage darf bis zu 65 Sekunden dauern)
- `POST /brain/cancel` und `POST /brain/reset` mit `{}`
- `PUT /brain` mit ausschließlich `{provider,localModel,groqModel}`

Unbekannte Konfigurationsfelder werden mit HTTP 400 abgewiesen. Der gesamten Bridge bleiben TLS, Authentifizierung, 16-KiB-Body-Limit und die vorhandenen Keep-Alive-/Header-Timeouts erhalten.

`voice_worker.py` spricht JSON Lines über stdin/stdout. Er nutzt bevorzugt `resourceDir/python/bin/python3` (Linux) bzw. `resourceDir/python/python.exe` (Windows), sonst `JARVIS_PYTHON`/System-Python, und benötigt `edge-tts` sowie optional `vosk` + `resourceDir/models/vosk-model-small-de-0.15`. Fehlende Worker-Abhängigkeiten werden nicht durch Fake-Ergebnisse ersetzt.
