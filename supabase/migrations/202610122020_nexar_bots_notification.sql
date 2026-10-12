-- Nexar-Bots-Benachrichtigung: sichere Android-Paarung, Widgets und Ereignisprotokoll.

ALTER TABLE public.nb_tasks
  ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'webhook';

ALTER TABLE public.nb_tasks
  ADD COLUMN IF NOT EXISTS notification_device_id text;

CREATE TABLE IF NOT EXISTS public.nb_notification_pairings (
  id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.nb_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS public.nb_notification_devices (
  id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.nb_users(id) ON DELETE CASCADE,
  installation_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  platform text NOT NULL DEFAULT 'android',
  token_hash text NOT NULL,
  fcm_push_token text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  last_seen_at bigint
);

CREATE TABLE IF NOT EXISTS public.nb_notification_widgets (
  id text PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES public.nb_tasks(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES public.nb_notification_devices(id) ON DELETE CASCADE,
  widget_key text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (task_id, device_id, widget_key)
);

CREATE TABLE IF NOT EXISTS public.nb_notification_events (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES public.nb_notification_devices(id) ON DELETE CASCADE,
  task_id bigint REFERENCES public.nb_tasks(id) ON DELETE SET NULL,
  bot_id bigint REFERENCES public.nb_bots(id) ON DELETE SET NULL,
  title text NOT NULL,
  payload jsonb NOT NULL,
  created_at bigint NOT NULL,
  push_sent_at bigint,
  seen_at bigint,
  dismissed_at bigint
);

CREATE INDEX IF NOT EXISTS nb_notification_pairings_expiry_idx
  ON public.nb_notification_pairings (expires_at);
CREATE INDEX IF NOT EXISTS nb_notification_devices_user_idx
  ON public.nb_notification_devices (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS nb_notification_widgets_task_device_idx
  ON public.nb_notification_widgets (task_id, device_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS nb_notification_events_device_pending_idx
  ON public.nb_notification_events (device_id, created_at DESC)
  WHERE dismissed_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nb_tasks_delivery_type_check'
  ) THEN
    ALTER TABLE public.nb_tasks
      ADD CONSTRAINT nb_tasks_delivery_type_check
      CHECK (delivery_type IN ('webhook', 'nexar_notification'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nb_tasks_notification_device_fk'
  ) THEN
    ALTER TABLE public.nb_tasks
      ADD CONSTRAINT nb_tasks_notification_device_fk
      FOREIGN KEY (notification_device_id)
      REFERENCES public.nb_notification_devices(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO nexar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.nb_notification_pairings,
  public.nb_notification_devices,
  public.nb_notification_widgets,
  public.nb_notification_events
TO nexar_app;
