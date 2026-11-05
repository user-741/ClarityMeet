-- Security fixes for row-level security policies found in the live project.
-- Safe to run more than once.

-- 1. Any signed-in user could add themselves (as admin!) to ANY workspace.
--    Joining now only happens through accept_workspace_invite() (SECURITY
--    DEFINER) or the server's service-role key, so ordinary clients need
--    no direct INSERT at all - only owners/admins adding people.
DROP POLICY IF EXISTS wm_insert ON public.workspace_members;
CREATE POLICY wm_insert ON public.workspace_members AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_admin(workspace_id));

-- 2. Members could UPDATE their own membership row, e.g. promote themselves to admin.
--    Only the owner or an admin may change roles, and nobody may move a row
--    into a different workspace.
DROP POLICY IF EXISTS wm_update ON public.workspace_members;
CREATE POLICY wm_update ON public.workspace_members AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_admin(workspace_id));

-- 3. The invitee could UPDATE their own invite (no WITH CHECK), e.g. change
--    role to admin or point it at another workspace before accepting.
--    Acceptance is done by accept_workspace_invite(), so only the
--    workspace owner may edit/revoke invites directly.
DROP POLICY IF EXISTS workspace_invites_update ON public.workspace_invites;
CREATE POLICY workspace_invites_update ON public.workspace_invites AS PERMISSIVE FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()));

-- 4. Any signed-in user could create notifications for ANY other user
--    (spoofed "success" messages with links). Notifications are written by
--    the backend with the service-role key, which bypasses RLS anyway.
DROP POLICY IF EXISTS notifs_insert ON public.notifications;
CREATE POLICY notifs_insert ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 5. Anyone (even logged out) could overwrite any file in the recordings bucket.
DROP POLICY IF EXISTS recordings_server_update ON storage.objects;
CREATE POLICY recordings_server_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public
  USING (bucket_id = 'recordings' AND auth.role() = 'service_role');
