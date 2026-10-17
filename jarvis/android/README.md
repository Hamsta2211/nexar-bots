# Jarvis für Android

Android 8 oder neuer. Medien lokal oder am gekoppelten PC steuern, Wetter abrufen, Einstellungen synchronisieren und die offiziellen Anbieter-Apps öffnen. Voice-Sitzungen fremder Apps können nicht zuverlässig automatisch gestartet oder beendet werden. Die eigene Spracherkennung läuft nur sichtbar im Vordergrund.

## Bauen

```sh
./gradlew --offline assembleDebug
./gradlew --offline assembleRelease
```

Release-Version: 0.3.0, Versionscode 3, nicht debuggbar. Ergebnis: `app/build/outputs/apk/release/app-release.apk`.

Die Signierkonfiguration wird aus `JARVIS_SIGNING_PROPERTIES`, alternativ `android/signing.properties`, andernfalls aus `~/.local/share/jarvis-build/signing.properties` geladen. Sie enthält `storeFile`, `storePassword`, `keyAlias` und `keyPassword`. Auf diesem Build-Rechner liegen der stabile private Schlüssel und die Konfiguration unter:

- `/home/ubuntu/.local/share/jarvis-build/android-release.jks`
- `/home/ubuntu/.local/share/jarvis-build/signing.properties`

Beide Dateien sind nur für den Besitzer lesbar. Nicht ins Repository, Quellarchiv oder Download-Paket aufnehmen. Für spätere Updates muss derselbe Schlüssel sicher erhalten bleiben. Eine alte Debug-APK hat eine andere Signatur und muss vor dem Wechsel entfernt werden; lokale Daten gehen dabei verloren.

## Verbindung

Am PC unter Konto → Geräte einen Code erzeugen und hier unter Geräte einfügen. Die Einladung enthält HTTPS-Adresse, einmaliges Geheimnis und SHA-256-Zertifikat-Pin. Die Verbindung akzeptiert ausschließlich das gepinnte Zertifikat. Medien werden bei bestehender Kopplung an den PC gesendet; ohne Kopplung an Androids System-Medientasten.

Für Einstellungen dasselbe E-Mail/Passwort-Konto wie am Desktop verwenden. Ausstehende Änderungen werden lokal behalten und als atomare Feld-Patches synchronisiert. Ein fehlgeschlagener Abruf überschreibt keine Profile mit Standardwerten. Access-/Refresh-Token werden mit Android Keystore AES/GCM verschlüsselt gespeichert; alte Klartext-Token werden einmalig migriert und gelöscht.

Die Stimmliste und Vorschau verwenden den gekoppelten PC und dessen Python-edge-tts-Dienst. Standard ist Conrad. Wetter wird direkt über Open-Meteo geladen und benötigt keine PC-Kopplung.

## Prüfung

Release-Build und APK-Signatur lassen sich hier prüfen. Es ist kein echtes Telefon verbunden und keine Android-Laufzeitprüfung per Emulator erfolgt. Daher sind Telefon-Mikrofon, reale Medien-Sitzungen und angemeldete Anbieter-Apps noch nicht praktisch abgenommen.
