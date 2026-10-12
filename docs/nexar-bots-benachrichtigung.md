# Nexar-Bots-Benachrichtigung

Die **Nexar-Bots-Benachrichtigung** ist ein eigener Ausgabekanal für Automationen. Sie verbindet eine Android-Installation über einen kurzlebigen Kopplungscode mit der privaten Nexar-Bots-Instanz. Weder Web-Sitzungen noch Datenbankzugangsdaten werden an die App übertragen.

## Ablauf

1. In **Automationen** wird als Ziel *Nexar-Bots-Benachrichtigung* gewählt und ein Android-Gerät per einmaligem Code gekoppelt.
2. Bei jedem Lauf lädt Nexar die bereits für diese Automation und dieses Gerät gespeicherten Widgets.
3. Der Bot erhält diese Widget-Bibliothek im Laufzeit-Systemprompt und liefert eine streng validierbare JSON-Anzeigeantwort zurück.
4. Der Server prüft die Antwort, übernimmt Widget-Anpassungen und Ereignis-Snapshot in einer Datenbanktransaktion und sendet – bei vorhandener Firebase-Serverkonfiguration – einen FCM-Datenpush.
5. Die Android-App ruft offene Ereignisse zusätzlich beim Start, beim Zurückkehren in den Vordergrund und über WorkManager ab. Ein FCM-Ereignis wird lokal zwischengespeichert. Ist der Bildschirm beim Empfang gesperrt/aus, merkt der `USER_PRESENT`-Receiver die Anzeige für den nächsten Entsperrvorgang vor; Android-Hintergrundregeln können den automatischen Start begrenzen, daher bleibt stets eine priorisierte Systembenachrichtigung als zuverlässiger Fallback bestehen.

## Anzeigevertrag `notification.v1`

```json
{
  "version": 1,
  "title": "Morgen-Briefing",
  "summary": "Drei relevante Entwicklungen.",
  "blocks": [
    { "type": "heading", "text": "KI-Markt" },
    { "type": "text", "text": "…" },
    { "type": "list", "items": ["Punkt A", "Punkt B"] },
    { "type": "metric", "label": "Änderung", "value": "+8 %" }
  ],
  "widgetOperations": [
    {
      "op": "upsert",
      "key": "market-sentiment",
      "kind": "status",
      "title": "Stimmung",
      "data": { "label": "Positiv", "tone": "success" }
    }
  ]
}
```

Erlaubte Blocktypen sind `heading`, `text`, `list`, `quote`, `metric` und `code`. Erlaubte Widgets sind `status`, `metric`, `checklist`, `progress` und `action`. Das mobile UI enthält einen defensiven Fallback für nicht strukturierten Text und erkennt dabei Markdown-Überschriften, Zitate, Listen und einfache Kennzahlen.

Der Server setzt den Ausführungszeitpunkt als `occurredAt` in jedes Ereignis. Die App zeigt ihn oben im Vollbild an; dadurch kann der Bot weder Datum noch Uhrzeit vergessen oder verfälschen.

## Sicherheit

- Kopplungscodes sind zufällig, einmalig und zehn Minuten gültig.
- Der langfristige Gerätezugangstoken wird ausschließlich gehasht in Supabase gespeichert.
- Android verwendet für die Zugangsdaten verschlüsselten lokalen Speicher.
- Die mobilen Endpunkte sind tokengebunden; das Web-API bleibt durch die vorhandene Nexar-Sitzung geschützt.
- FCM-Datenpushes enthalten ausschließlich die Ereignis-ID. Die vollständigen Daten lädt die App nur nach Tokenprüfung nach.

## Betrieb

Die Android-App benötigt für Produktions-Pushes eine Firebase-Konfiguration in `mobile/nexar-notification/app/google-services.json` (nicht einchecken); der Server braucht zusätzlich `FIREBASE_SERVICE_ACCOUNT_JSON` als Render-Secret. Ohne diese Angaben bleibt das Polling aktiv; die App ist dadurch weiterhin funktionsfähig, aber nicht sofort zustellend.
