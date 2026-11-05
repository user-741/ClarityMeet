-- ClarityMeet - baseline schema exported from the live Supabase project
-- (project ref vyaiuwazgxjceoqtxtvv) on 2026-10-22.
-- Recreate the database on a fresh project by running the files in
-- supabase/migrations in order (or `supabase db push`).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

CREATE TYPE public.bot_status AS ENUM ('idle', 'joining', 'recording', 'processing', 'complete', 'failed');

CREATE TYPE public.log_level AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL');

CREATE TYPE public.meeting_platform AS ENUM ('zoom', 'google_meet', 'teams', 'webex', 'upload', 'other');

CREATE TYPE public.meeting_status AS ENUM ('scheduled', 'joining', 'recording', 'processing', 'transcribing', 'summarising', 'complete', 'failed', 'partial');

CREATE TYPE public.notification_type AS ENUM ('success', 'warning', 'error', 'info');

CREATE TYPE public.task_priority AS ENUM ('High', 'Medium', 'Low');

CREATE TYPE public.task_status AS ENUM ('Open', 'In Progress', 'Completed', 'Cancelled');

CREATE TYPE public.upload_status AS ENUM ('queued', 'uploading', 'processing', 'complete', 'failed');

CREATE TYPE public.user_role AS ENUM ('admin', 'member', 'viewer');

CREATE TABLE public.app_config (
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  user_id uuid,
  workspace_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  payload jsonb,
  ip_address inet,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bots (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  meeting_id uuid,
  platform meeting_platform DEFAULT 'zoom'::meeting_platform NOT NULL,
  meeting_url text NOT NULL,
  status bot_status DEFAULT 'idle'::bot_status NOT NULL,
  bot_instance_id text,
  error_message text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.calendar_feeds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  feed_url text NOT NULL,
  provider text NOT NULL,
  last_synced timestamp with time zone,
  event_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.meeting_highlights (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  meeting_id uuid NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.meeting_participants (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  meeting_id uuid NOT NULL,
  user_id uuid,
  display_name text NOT NULL,
  email text,
  speaker_label text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.meetings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  zoom_link text,
  scheduled_at timestamp with time zone,
  status text DEFAULT 'scheduled'::text,
  workspace_id uuid,
  owner_id uuid,
  title text,
  platform text DEFAULT 'zoom'::text NOT NULL,
  meeting_url text,
  external_id text,
  audio_path text,
  transcript text,
  summary text,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_secs integer,
  participant_count integer DEFAULT 0,
  task_count integer DEFAULT 0,
  transcribed_at timestamp with time zone,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  external_uid text
);

CREATE TABLE public.notifications (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid,
  type notification_type DEFAULT 'info'::notification_type NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.system_logs (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  level log_level DEFAULT 'INFO'::log_level NOT NULL,
  message text NOT NULL,
  context jsonb,
  user_id uuid,
  workspace_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  meeting_id uuid,
  participant text,
  description text,
  priority text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  workspace_id uuid,
  created_by uuid,
  assignee_id uuid,
  assignee_name text,
  title text,
  status text DEFAULT 'Open'::text NOT NULL,
  due_date date,
  completed_at timestamp with time zone,
  ai_extracted boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.uploads (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  meeting_id uuid,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  status upload_status DEFAULT 'queued'::upload_status NOT NULL,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_preferences (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  user_id uuid NOT NULL,
  theme text DEFAULT 'dark'::text NOT NULL,
  email_summaries boolean DEFAULT true NOT NULL,
  email_task_reminders boolean DEFAULT true NOT NULL,
  email_weekly_digest boolean DEFAULT false NOT NULL,
  email_mentions boolean DEFAULT true NOT NULL,
  email_bot_status boolean DEFAULT true NOT NULL,
  bot_auto_join boolean DEFAULT false NOT NULL,
  bot_auto_summarise boolean DEFAULT true NOT NULL,
  bot_email_participants boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  name text,
  role text DEFAULT 'user'::text,
  first_name text,
  last_name text,
  organisation text,
  timezone text DEFAULT 'UTC'::text NOT NULL,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workspace_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  email text NOT NULL,
  role user_role DEFAULT 'member'::user_role NOT NULL,
  invited_by uuid NOT NULL,
  token uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone
);

CREATE TABLE public.workspace_members (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role user_role DEFAULT 'member'::user_role NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workspaces (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name text NOT NULL,
  owner_id uuid NOT NULL,
  plan text DEFAULT 'free'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.app_config ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.bots ADD CONSTRAINT bots_pkey PRIMARY KEY (id);

ALTER TABLE public.calendar_feeds ADD CONSTRAINT calendar_feeds_pkey PRIMARY KEY (id);

ALTER TABLE public.calendar_feeds ADD CONSTRAINT calendar_feeds_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'icloud'::text, 'outlook'::text, 'other'::text])));

ALTER TABLE public.meeting_highlights ADD CONSTRAINT meeting_highlights_pkey PRIMARY KEY (id);

ALTER TABLE public.meeting_participants ADD CONSTRAINT meeting_participants_pkey PRIMARY KEY (id);

ALTER TABLE public.meetings ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE public.system_logs ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE public.uploads ADD CONSTRAINT uploads_pkey PRIMARY KEY (id);

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_user_id_key UNIQUE (user_id);

ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_pkey PRIMARY KEY (id);

ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_token_key UNIQUE (token);

ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_workspace_id_email_key UNIQUE (workspace_id, email);

ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);

ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);

ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE public.bots ADD CONSTRAINT bots_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL;

ALTER TABLE public.bots ADD CONSTRAINT bots_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.bots ADD CONSTRAINT bots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.calendar_feeds ADD CONSTRAINT calendar_feeds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.calendar_feeds ADD CONSTRAINT calendar_feeds_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.meeting_highlights ADD CONSTRAINT meeting_highlights_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE;

ALTER TABLE public.meeting_participants ADD CONSTRAINT meeting_participants_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE;

ALTER TABLE public.meeting_participants ADD CONSTRAINT meeting_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.meetings ADD CONSTRAINT meetings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.meetings ADD CONSTRAINT meetings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.system_logs ADD CONSTRAINT system_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.system_logs ADD CONSTRAINT system_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE public.tasks ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.uploads ADD CONSTRAINT uploads_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL;

ALTER TABLE public.uploads ADD CONSTRAINT uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.uploads ADD CONSTRAINT uploads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX calendar_feeds_user_idx ON public.calendar_feeds USING btree (user_id);

CREATE INDEX calendar_feeds_ws_idx ON public.calendar_feeds USING btree (workspace_id);

CREATE INDEX idx_audit_created ON public.audit_logs USING btree (created_at DESC);

CREATE INDEX idx_audit_user ON public.audit_logs USING btree (user_id);

CREATE INDEX idx_bots_status ON public.bots USING btree (status);

CREATE INDEX idx_bots_user ON public.bots USING btree (user_id);

CREATE INDEX idx_bots_workspace ON public.bots USING btree (workspace_id);

CREATE INDEX idx_meetings_created ON public.meetings USING btree (created_at DESC);

CREATE INDEX idx_meetings_external_uid ON public.meetings USING btree (external_uid);

CREATE INDEX idx_meetings_fts ON public.meetings USING gin (to_tsvector('english'::regconfig, ((((COALESCE(title, ''::text) || ' '::text) || COALESCE(summary, ''::text)) || ' '::text) || COALESCE(transcript, ''::text))));

CREATE INDEX idx_meetings_owner ON public.meetings USING btree (owner_id);

CREATE INDEX idx_meetings_platform ON public.meetings USING btree (platform);

CREATE INDEX idx_meetings_status ON public.meetings USING btree (status);

CREATE INDEX idx_meetings_title_trgm ON public.meetings USING gin (title gin_trgm_ops);

CREATE INDEX idx_meetings_workspace ON public.meetings USING btree (workspace_id);

CREATE INDEX idx_meetings_workspace_status ON public.meetings USING btree (workspace_id, status);

CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at DESC);

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, read) WHERE (read = false);

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);

CREATE INDEX idx_syslog_level ON public.system_logs USING btree (level, created_at DESC);

CREATE INDEX idx_tasks_assignee ON public.tasks USING btree (assignee_id);

CREATE INDEX idx_tasks_created ON public.tasks USING btree (created_at DESC);

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date);

CREATE INDEX idx_tasks_fts ON public.tasks USING gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(description, ''::text))));

CREATE INDEX idx_tasks_meeting ON public.tasks USING btree (meeting_id);

CREATE INDEX idx_tasks_priority ON public.tasks USING btree (priority);

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);

CREATE INDEX idx_tasks_title_trgm ON public.tasks USING gin (title gin_trgm_ops);

CREATE INDEX idx_tasks_workspace ON public.tasks USING btree (workspace_id);

CREATE INDEX idx_wm_user ON public.workspace_members USING btree (user_id);

CREATE INDEX idx_wm_workspace ON public.workspace_members USING btree (workspace_id);

CREATE INDEX meetings_external_uid_idx ON public.meetings USING btree (workspace_id, external_uid) WHERE (external_uid IS NOT NULL);

CREATE INDEX workspace_invites_email_idx ON public.workspace_invites USING btree (lower(email));

CREATE INDEX workspace_invites_pending_idx ON public.workspace_invites USING btree (workspace_id, lower(email)) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX workspace_invites_workspace_id_idx ON public.workspace_invites USING btree (workspace_id);

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_workspace_id uuid)
 RETURNS TABLE(workspace_id uuid, workspace_name text, role user_role)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_user_id uuid;
  v_email text;
  v_invite public.workspace_invites%rowtype;
  v_workspace public.workspaces%rowtype;
begin
  v_user_id := auth.uid();
  v_email := lower(auth.jwt() ->> 'email');

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_workspace_id is null then
    raise exception 'Workspace id is required';
  end if;

  if v_email is null or length(trim(v_email)) = 0 then
    raise exception 'Authenticated email missing from JWT';
  end if;

  select w.*
  into v_workspace
  from public.workspaces as w
  where w.id = p_workspace_id;

  if not found then
    raise exception 'Workspace not found';
  end if;

  select wi.*
  into v_invite
  from public.workspace_invites as wi
  where wi.workspace_id = p_workspace_id
    and lower(wi.email) = v_email
    and wi.accepted_at is null
    and wi.revoked_at is null
  order by wi.created_at desc
  limit 1;

  if not found then
    raise exception 'No valid pending invite found for this workspace and email';
  end if;

  -- Don't let an invite downgrade the workspace owner's role.
  if v_workspace.owner_id = v_user_id then
    insert into public.workspace_members (workspace_id, user_id, role, joined_at)
    values (p_workspace_id, v_user_id, 'admin', now())
    on conflict (workspace_id, user_id) do nothing;
  else
    insert into public.workspace_members (workspace_id, user_id, role, joined_at)
    values (p_workspace_id, v_user_id, v_invite.role, now())
    on conflict (workspace_id, user_id)
    do update set role = excluded.role;
  end if;

  update public.workspace_invites as wi
  set accepted_at = now()
  where wi.id = v_invite.id;

  return query
  select
    v_workspace.id   as workspace_id,
    v_workspace.name as workspace_name,
    case when v_workspace.owner_id = v_user_id then 'admin'::user_role else v_invite.role end as role;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_workspace_invite(p_workspace_id uuid, p_email text, p_role user_role DEFAULT 'member'::user_role)
 RETURNS workspace_invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inviter uuid;
  v_email text;
  v_row public.workspace_invites;
begin
  v_inviter := auth.uid();
  v_email := lower(trim(p_email));

  if v_inviter is null then
    raise exception 'Not authenticated';
  end if;

  if p_workspace_id is null then
    raise exception 'Workspace id is required';
  end if;

  if v_email is null or v_email = '' then
    raise exception 'Invite email is required';
  end if;

  -- Simple admin check: owner or admin member
  if not (
    exists (
      select 1
      from public.workspaces w
      where w.id = p_workspace_id
        and w.owner_id = v_inviter
    )
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = v_inviter
        and wm.role = 'admin'::public.user_role
    )
  ) then
    raise exception 'Not allowed to invite users to this workspace';
  end if;

  insert into public.workspace_invites (
    workspace_id,
    email,
    role,
    invited_by
  )
  values (
    p_workspace_id,
    v_email,
    p_role,
    v_inviter
  )
  on conflict (workspace_id, email)
  do update set
    role        = excluded.role,
    invited_by  = excluded.invited_by,
    accepted_at = null,
    revoked_at  = null,
    created_at  = now()
  returning *
  into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_workspace_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_workspace_id UUID;
BEGIN
  -- Insert into public.users (ON CONFLICT so safe to re-run)
  INSERT INTO public.users (id, email, first_name, last_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Only create workspace if user has no workspace yet
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = NEW.id) THEN
    INSERT INTO public.workspaces (name, owner_id, plan, created_at, updated_at)
    VALUES (
      COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)) || '''s Workspace',
      NEW.id, 'free', NOW(), NOW()
    )
    RETURNING id INTO new_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role, joined_at)
    VALUES (new_workspace_id, NEW.id, 'admin', NOW())
    ON CONFLICT DO NOTHING;
  END IF;

  -- Default preferences (idempotent)
  INSERT INTO public.user_preferences (user_id, created_at, updated_at)
  VALUES (NEW.id, NOW(), NOW())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_task_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status <> 'Completed' THEN
    NEW.completed_at = NOW();
  ELSIF NEW.status <> 'Completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_workspace_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_has_admin boolean;
begin
  if public.is_workspace_owner(_workspace_id, _user_id) then
    return true;
  end if;

  select exists (
    select 1
    from unnest(enum_range(null::public.user_role)) e
    where e::text = 'admin'
  )
  into v_has_admin;

  if not v_has_admin then
    return false;
  end if;

  return exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = _workspace_id
      and wm.user_id = _user_id
      and wm.role = 'admin'::public.user_role
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND role = 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = _workspace_id
      and wm.user_id = _user_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member_definer(p_workspace_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.workspaces w
    where w.id = _workspace_id
      and w.owner_id = _user_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_owner_definer(p_workspace_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return exists (
    select 1
    from public.workspaces w
    where w.id = p_workspace_id
      and w.owner_id = p_user_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_workspace(p_workspace_id uuid, p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(result_type text, id uuid, title text, snippet text, rank real, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM (
    SELECT 'meeting'::TEXT AS result_type,
      m.id,
      COALESCE(m.title, 'Untitled meeting') AS title,
      LEFT(COALESCE(m.summary, m.transcript, ''), 200) AS snippet,
      ts_rank(
        to_tsvector('english', COALESCE(m.title,'') || ' ' || COALESCE(m.summary,'') || ' ' || COALESCE(m.transcript,'')),
        plainto_tsquery('english', p_query)
      ) AS rank,
      m.created_at
    FROM public.meetings m
    WHERE m.workspace_id = p_workspace_id
      AND to_tsvector('english', COALESCE(m.title,'') || ' ' || COALESCE(m.summary,'') || ' ' || COALESCE(m.transcript,''))
          @@ plainto_tsquery('english', p_query)

    UNION ALL

    SELECT 'task'::TEXT,
      t.id,
      t.title,
      LEFT(COALESCE(t.description,''), 200),
      ts_rank(
        to_tsvector('english', COALESCE(t.title,'') || ' ' || COALESCE(t.description,'')),
        plainto_tsquery('english', p_query)
      ),
      t.created_at
    FROM public.tasks t
    WHERE t.workspace_id = p_workspace_id
      AND to_tsvector('english', COALESCE(t.title,'') || ' ' || COALESCE(t.description,''))
          @@ plainto_tsquery('english', p_query)
  ) results
  ORDER BY results.rank DESC, results.created_at DESC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_meeting_duration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.ended_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
    NEW.duration_secs = EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at))::INTEGER;
  ELSE
    NEW.duration_secs = NULL;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_meeting_task_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.meeting_id IS NOT NULL THEN
    UPDATE public.meetings SET task_count = task_count + 1 WHERE id = NEW.meeting_id;
  ELSIF TG_OP = 'DELETE' AND OLD.meeting_id IS NOT NULL THEN
    UPDATE public.meetings SET task_count = GREATEST(task_count - 1, 0) WHERE id = OLD.meeting_id;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE VIEW public.meetings_summary WITH (security_invoker=true) AS
 SELECT m.id,
    m.workspace_id,
    m.title,
    m.platform,
    m.status,
    m.started_at,
    m.ended_at,
    m.duration_secs,
    m.participant_count,
    m.task_count,
    m.created_at,
    m.updated_at,
    COALESCE((u.first_name || ' '::text) || u.last_name, u.email) AS owner_name
   FROM meetings m
     LEFT JOIN users u ON u.id = m.owner_id;

CREATE OR REPLACE VIEW public.tasks_detail WITH (security_invoker=true) AS
 SELECT t.id,
    t.workspace_id,
    t.meeting_id,
    m.title AS meeting_title,
    t.title,
    t.description,
    t.priority,
    t.status,
    t.due_date,
    t.completed_at,
    t.ai_extracted,
    t.created_at,
    t.updated_at,
    COALESCE((u.first_name || ' '::text) || u.last_name, u.email, t.assignee_name, 'Unassigned'::text) AS assignee_display,
    t.assignee_id
   FROM tasks t
     LEFT JOIN meetings m ON m.id = t.meeting_id
     LEFT JOIN users u ON u.id = t.assignee_id;

CREATE OR REPLACE VIEW public.workspace_stats WITH (security_invoker=true) AS
 SELECT w.id AS workspace_id,
    w.name AS workspace_name,
    count(DISTINCT m.id) AS total_meetings,
    count(DISTINCT m.id) FILTER (WHERE m.created_at >= date_trunc('month'::text, now())) AS meetings_this_month,
    count(DISTINCT t.id) AS total_tasks,
    count(DISTINCT t.id) FILTER (WHERE t.status = 'Open'::text) AS open_tasks,
    count(DISTINCT t.id) FILTER (WHERE t.status = 'In Progress'::text) AS in_progress_tasks,
    count(DISTINCT t.id) FILTER (WHERE t.status = 'Completed'::text) AS completed_tasks,
        CASE
            WHEN count(DISTINCT t.id) = 0 THEN 0::numeric
            ELSE round(100.0 * count(DISTINCT t.id) FILTER (WHERE t.status = 'Completed'::text)::numeric / count(DISTINCT t.id)::numeric)
        END AS completion_rate_pct,
    count(DISTINCT wm.user_id) AS member_count
   FROM workspaces w
     LEFT JOIN meetings m ON m.workspace_id = w.id
     LEFT JOIN tasks t ON t.workspace_id = w.id
     LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
  GROUP BY w.id, w.name;

CREATE TRIGGER trg_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

CREATE TRIGGER trg_bots_updated_at BEFORE UPDATE ON public.bots FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_meeting_duration BEFORE INSERT OR UPDATE OF started_at, ended_at ON public.meetings FOR EACH ROW EXECUTE FUNCTION sync_meeting_duration();

CREATE TRIGGER trg_meetings_updated_at BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_task_completed_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION handle_task_completion();

CREATE TRIGGER trg_task_count_sync AFTER INSERT OR DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION sync_meeting_task_count();

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_uploads_updated_at BEFORE UPDATE ON public.uploads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meeting_highlights ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_deny ON public.audit_logs AS PERMISSIVE FOR ALL TO public
  USING (false);

CREATE POLICY "Workspace members can read bots" ON public.bots AS PERMISSIVE FOR SELECT TO authenticated
  USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));

CREATE POLICY bots_insert ON public.bots AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY bots_select ON public.bots AS PERMISSIVE FOR SELECT TO public
  USING (is_workspace_member(workspace_id));

CREATE POLICY bots_update ON public.bots AS PERMISSIVE FOR UPDATE TO public
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Users manage own calendar feeds" ON public.calendar_feeds AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY mh_insert ON public.meeting_highlights AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_highlights.meeting_id) AND is_workspace_member(m.workspace_id)))));

CREATE POLICY mh_select ON public.meeting_highlights AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_highlights.meeting_id) AND is_workspace_member(m.workspace_id)))));

CREATE POLICY mp_insert ON public.meeting_participants AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_participants.meeting_id) AND is_workspace_member(m.workspace_id)))));

CREATE POLICY mp_select ON public.meeting_participants AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_participants.meeting_id) AND is_workspace_member(m.workspace_id)))));

CREATE POLICY meetings_delete ON public.meetings AS PERMISSIVE FOR DELETE TO public
  USING ((is_workspace_admin(workspace_id) OR (owner_id = auth.uid())));

CREATE POLICY meetings_insert ON public.meetings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY meetings_select ON public.meetings AS PERMISSIVE FOR SELECT TO public
  USING (is_workspace_member(workspace_id));

CREATE POLICY meetings_update ON public.meetings AS PERMISSIVE FOR UPDATE TO public
  USING (is_workspace_member(workspace_id));

CREATE POLICY notifs_delete ON public.notifications AS PERMISSIVE FOR DELETE TO public
  USING ((user_id = auth.uid()));

CREATE POLICY notifs_insert ON public.notifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY notifs_select ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));

CREATE POLICY notifs_update ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = auth.uid()));

CREATE POLICY syslog_deny ON public.system_logs AS PERMISSIVE FOR ALL TO public
  USING (false);

CREATE POLICY tasks_delete ON public.tasks AS PERMISSIVE FOR DELETE TO public
  USING ((is_workspace_admin(workspace_id) OR (created_by = auth.uid())));

CREATE POLICY tasks_insert ON public.tasks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY tasks_select ON public.tasks AS PERMISSIVE FOR SELECT TO public
  USING (is_workspace_member(workspace_id));

CREATE POLICY tasks_update ON public.tasks AS PERMISSIVE FOR UPDATE TO public
  USING (is_workspace_member(workspace_id));

CREATE POLICY uploads_insert ON public.uploads AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY uploads_select ON public.uploads AS PERMISSIVE FOR SELECT TO public
  USING (is_workspace_member(workspace_id));

CREATE POLICY prefs_insert ON public.user_preferences AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY prefs_select ON public.user_preferences AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));

CREATE POLICY prefs_update ON public.user_preferences AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = auth.uid()));

CREATE POLICY users_insert ON public.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((id = auth.uid()));

CREATE POLICY users_insert_own ON public.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((id = auth.uid()));

CREATE POLICY users_select_own ON public.users AS PERMISSIVE FOR SELECT TO public
  USING ((id = auth.uid()));

CREATE POLICY users_select_workspace_members ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (((id = auth.uid()) OR (id IN ( SELECT wm2.user_id
   FROM workspace_members wm2
  WHERE (wm2.workspace_id IN ( SELECT wm1.workspace_id
           FROM workspace_members wm1
          WHERE (wm1.user_id = auth.uid())))))));

CREATE POLICY users_update ON public.users AS PERMISSIVE FOR UPDATE TO public
  USING ((id = auth.uid()));

CREATE POLICY users_update_own ON public.users AS PERMISSIVE FOR UPDATE TO public
  USING ((id = auth.uid()));

CREATE POLICY workspace_invites_delete ON public.workspace_invites AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_invites.workspace_id) AND (w.owner_id = auth.uid())))));

CREATE POLICY workspace_invites_insert ON public.workspace_invites AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_invites.workspace_id) AND (w.owner_id = auth.uid())))));

CREATE POLICY workspace_invites_select ON public.workspace_invites AS PERMISSIVE FOR SELECT TO authenticated
  USING (((lower(email) = lower((auth.jwt() ->> 'email'::text))) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_invites.workspace_id) AND (w.owner_id = auth.uid()))))));

CREATE POLICY workspace_invites_update ON public.workspace_invites AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((lower(email) = lower((auth.jwt() ->> 'email'::text))) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_invites.workspace_id) AND (w.owner_id = auth.uid()))))))
  WITH CHECK (((lower(email) = lower((auth.jwt() ->> 'email'::text))) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_invites.workspace_id) AND (w.owner_id = auth.uid()))))));

CREATE POLICY wm_delete ON public.workspace_members AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid())))));

CREATE POLICY wm_insert ON public.workspace_members AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY wm_select ON public.workspace_members AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid())))) OR is_workspace_member(workspace_id)));

CREATE POLICY wm_update ON public.workspace_members AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid()))))))
  WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid()))))));

CREATE POLICY workspaces_delete ON public.workspaces AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_workspace_owner_definer(id, auth.uid()));

CREATE POLICY workspaces_insert ON public.workspaces AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((owner_id = auth.uid()));

CREATE POLICY workspaces_select ON public.workspaces AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_workspace_owner_definer(id, auth.uid()) OR is_workspace_member_definer(id, auth.uid())));

CREATE POLICY workspaces_update ON public.workspaces AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_workspace_owner_definer(id, auth.uid()))
  WITH CHECK (is_workspace_owner_definer(id, auth.uid()));

CREATE POLICY recordings_server_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public
  USING ((bucket_id = 'recordings'::text));

CREATE POLICY recordings_workspace_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((bucket_id = 'recordings'::text) AND ((auth.role() = 'service_role'::text) OR ((auth.role() = 'authenticated'::text) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.user_id = auth.uid()) AND (objects.name ~~ ((wm.workspace_id)::text || '/%'::text)))))))));

CREATE POLICY recordings_workspace_read ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING (((bucket_id = 'recordings'::text) AND ((auth.role() = 'service_role'::text) OR ((auth.role() = 'authenticated'::text) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.user_id = auth.uid()) AND ((objects.name ~~ ((wm.workspace_id)::text || '/%'::text)) OR (objects.name !~~ '%/%'::text)))))))));

INSERT INTO storage.buckets (id, name, public) VALUES ('recordings', 'recordings', t) ON CONFLICT (id) DO NOTHING;
