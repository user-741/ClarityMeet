-- 1. Recordings are private. Files were public, and their names were
--    timestamps, so anyone could guess a URL and download a meeting.
--    The app and server now use storage paths and the service key instead.
UPDATE storage.buckets SET public = false WHERE id = 'recordings';

--    Members may only read files inside their own workspace's folder
--    (the old rule also exposed every file at the bucket root).
DROP POLICY IF EXISTS recordings_workspace_read ON storage.objects;
CREATE POLICY recordings_workspace_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    bucket_id = 'recordings'
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.user_id = auth.uid()
        AND objects.name LIKE wm.workspace_id::text || '/%'
    )
  );

-- 2. Viewers are read-only. Settings and invites describe "viewer" as a
--    read-only role, but the database let viewers create and edit
--    meetings, tasks and uploads.
CREATE OR REPLACE FUNCTION public.is_workspace_editor(ws_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND role IN ('admin', 'member')
  );
$$;

DROP POLICY IF EXISTS meetings_insert ON public.meetings;
CREATE POLICY meetings_insert ON public.meetings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_editor(workspace_id));
DROP POLICY IF EXISTS meetings_update ON public.meetings;
CREATE POLICY meetings_update ON public.meetings AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_workspace_editor(workspace_id)) WITH CHECK (public.is_workspace_editor(workspace_id));

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_editor(workspace_id));
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_workspace_editor(workspace_id)) WITH CHECK (public.is_workspace_editor(workspace_id));

DROP POLICY IF EXISTS uploads_insert ON public.uploads;
CREATE POLICY uploads_insert ON public.uploads AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_editor(workspace_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS recordings_workspace_insert ON storage.objects;
CREATE POLICY recordings_workspace_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recordings'
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
        AND objects.name LIKE wm.workspace_id::text || '/%'
    )
  );
