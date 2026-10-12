-- Härtung: Supabase-RLS, FCM-Token und Schutz vor direktem PostgREST-Zugriff.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nb_notification_devices' AND column_name = 'expo_push_token'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nb_notification_devices' AND column_name = 'fcm_push_token'
  ) THEN
    ALTER TABLE public.nb_notification_devices RENAME COLUMN expo_push_token TO fcm_push_token;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nb_notification_devices' AND column_name = 'fcm_push_token'
  ) THEN
    ALTER TABLE public.nb_notification_devices ADD COLUMN fcm_push_token text;
  END IF;
END
$$;

ALTER TABLE public.nb_notification_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nb_notification_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nb_notification_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nb_notification_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.nb_notification_pairings,
  public.nb_notification_devices,
  public.nb_notification_widgets,
  public.nb_notification_events
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.nb_notification_pairings,
  public.nb_notification_devices,
  public.nb_notification_widgets,
  public.nb_notification_events
TO nexar_app;

DROP POLICY IF EXISTS nb_notification_pairings_nexar_app ON public.nb_notification_pairings;
DROP POLICY IF EXISTS nb_notification_devices_nexar_app ON public.nb_notification_devices;
DROP POLICY IF EXISTS nb_notification_widgets_nexar_app ON public.nb_notification_widgets;
DROP POLICY IF EXISTS nb_notification_events_nexar_app ON public.nb_notification_events;

CREATE POLICY nb_notification_pairings_nexar_app ON public.nb_notification_pairings
  FOR ALL TO nexar_app USING (true) WITH CHECK (true);
CREATE POLICY nb_notification_devices_nexar_app ON public.nb_notification_devices
  FOR ALL TO nexar_app USING (true) WITH CHECK (true);
CREATE POLICY nb_notification_widgets_nexar_app ON public.nb_notification_widgets
  FOR ALL TO nexar_app USING (true) WITH CHECK (true);
CREATE POLICY nb_notification_events_nexar_app ON public.nb_notification_events
  FOR ALL TO nexar_app USING (true) WITH CHECK (true);
