# Nexar-Bots-Benachrichtigung – Umsetzung

- [x] **Automationen:** Unter dem Ziel ist **Nexar-Bots-Benachrichtigung** auswählbar; ein gekoppelte Android-Gerät kann ausgewählt werden.
- [x] **Kopplung:** Ein zeitlich begrenzter Einmalcode verknüpft die Android-App mit der Nexar-Instanz, ohne Web-Sitzung oder Datenbankzugangsdaten weiterzugeben.
- [x] **Bot-Formatierung und Widgets:** Jeder Benachrichtigungslauf erhält alle vorhandenen Widgets als Laufzeit-Systemprompt, liefert strukturierte Blöcke sowie Widget-Operationen und speichert diese in Supabase.
- [x] **Vollbild:** Die native Android-App rendert Datum/Uhrzeit, strukturierte Inhalte, animierte Widgets, scrollbar lange Inhalte und einen **Schließen**-Button.
- [x] **Zustellung:** FCM, lokale Pufferung, foreground/start-Synchronisierung und ein Entsperr-Empfänger stellen offene Ereignisse nach dem nächsten Entsperren dar; eine priorisierte Systembenachrichtigung bleibt als Android-Fallback erhalten.
- [ ] **Produktion:** Firebase-Android-Konfiguration einlegen, auf realem Gerät Berechtigungen bestätigen und APK/AAB in Android Studio erzeugen.
