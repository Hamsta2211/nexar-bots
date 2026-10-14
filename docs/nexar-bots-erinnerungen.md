# Automation-Erinnerungen

## Verhalten

Im Bereich **Automationen** gibt es die Reiter **Automationen** und **Erinnerungen**. Der zweite Reiter listet alle Erinnerungen und ermöglicht das Anlegen einer Erinnerung für eine ausgewählte Automation sowie das Löschen. Jede Automationszeile und der Bearbeitungsdialog enthalten zusätzlich den direkten Button **Erinnerungen** für die zugehörige Automation. Neue Erinnerungen bestehen aus Freitext (1–2.000 Zeichen) und sind sofort gespeichert.

Für Automationen, deren Ziel **Nexar-Bots-Benachrichtigung** auf das gekoppelte Android-Gerät ist, zeigt die Android-App alle zugeordneten Erinnerungen zusätzlich im eigenen **Erinnerungen**-Reiter. Ein Nutzer kann sie sowohl in der Website als auch direkt aus der App entfernen. Erinnerungen der Automation werden außerdem in jedes neue Benachrichtigungsereignis aufgenommen. Das Löschen einer Automation löscht deren Erinnerungen per Fremdschlüssel-Kaskade.

## API

- Geschützte Website-API: `GET /api/reminders` (optional `?taskId=`), `POST /api/tasks/:id/reminders` mit `{ "content": "…" }`, `DELETE /api/reminders/:id`.
- Geräteauthentifizierte API: `GET /mobile/reminders`, `DELETE /mobile/reminders/:id`. Das Gerät kann nur Erinnerungen von Automationen sehen oder löschen, die auf genau dieses Gerät zeigen.
- Ereignis-Pushes enthalten nur Ereignis-ID und kurze Vorschau. Änderungen an Website-Erinnerungen senden an gekoppelte Expo-Android-Geräte zusätzlich einen stillen FCM-Datenhinweis `{ "kind": "reminders_updated" }` ohne Erinnerungstext. Die App lädt die vollständige aktuelle Liste danach über die geräteauthentifizierte `GET /mobile/reminders`-Route und gleicht ihre dauerhaften Android-Hinweise ab.

FCM-Hintergrundzustellung setzt die Firebase-Android-Appkonfiguration der App und das Server-Secret `FIREBASE_SERVICE_ACCOUNT_JSON` voraus. Android kann Hintergrund-Pushs insbesondere in Doze-/Energiesparzuständen verzögern; die App synchronisiert beim nächsten Öffnen erneut. Samsung bestimmt separat, ob eine dauerhafte Android-Benachrichtigung eines Drittanbieters in der Now Bar angezeigt wird.

## Speicherung

`nb_task_reminders` speichert Text und Zeitstempel in Nexar-Bots Supabase/Postgres. RLS ist aktiv; anon/authenticated haben keinen Tabellenzugriff, die Nexar-Serverrolle `nexar_app` hat die erforderlichen Rechte. Migration: `supabase/migrations/202610122150_task_reminders.sql`.
