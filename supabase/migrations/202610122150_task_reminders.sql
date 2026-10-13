-- Nutzerverwaltete Erinnerungen zu Automationen; dieselben Datensätze werden
-- über die gekoppelten Android-Geräte und in Benachrichtigungsereignissen gezeigt.
CREATE TABLE IF NOT EXISTS public.nb_task_reminders (
  id text PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES public.nb_tasks(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS nb_task_reminders_task_idx
  ON public.nb_task_reminders (task_id, created_at DESC);

ALTER TABLE public.nb_task_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nb_task_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nb_task_reminders TO nexar_app;
DROP POLICY IF EXISTS nb_task_reminders_nexar_app ON public.nb_task_reminders;
CREATE POLICY nb_task_reminders_nexar_app ON public.nb_task_reminders
  FOR ALL TO nexar_app USING (true) WITH CHECK (true);
