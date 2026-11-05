-- SUPERSEDED: this file is out of date and no longer matches the live database.
-- Use supabase/migrations/*.sql instead (exported from the live project 2026-10-22).

-- ============================================================
-- ClarityMeet - Supabase PostgreSQL Schema (Refurbish Edition)
-- Safe to run on an EXISTING database - uses DROP IF EXISTS +
-- CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS
-- throughout so nothing breaks if tables already exist.
--
-- Changes from previous version:
--   - Removed student_id from users
--   - Removed api_keys table (APIs are developer .env vars)
--   - Removed integrations table (OAuth is server-side config)
--   - All DROP/CREATE are idempotent - safe to re-run anytime
--
-- Run in Supabase SQL Editor top to bottom, once.
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";


-- ============================================================
-- DROP OLD OBJECTS THAT NO LONGER EXIST IN THE NEW SCHEMA
-- Views first (they depend on tables), then orphaned tables,
-- then functions (so triggers can be recreated cleanly).
-- ============================================================

DROP VIEW IF EXISTS public.tasks_detail     CASCADE;
DROP VIEW IF EXISTS public.meetings_summary CASCADE;
DROP VIEW IF EXISTS public.workspace_stats  CASCADE;

DROP FUNCTION IF EXISTS public.search_workspace(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.is_workspace_admin(UUID);
DROP FUNCTION IF EXISTS public.is_workspace_member(UUID);
DROP FUNCTION IF EXISTS public.handle_task_completion();
DROP FUNCTION IF EXISTS public.sync_meeting_duration();
DROP FUNCTION IF EXISTS public.sync_meeting_task_count();
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
DROP FUNCTION IF EXISTS public.set_updated_at();

-- These two tables were removed - APIs live in .env now
DROP TABLE IF EXISTS public.api_keys     CASCADE;
DROP TABLE IF EXISTS public.integrations CASCADE;

-- Drop ENUMs so we can recreate with correct value sets
-- CASCADE drops any columns currently typed as these ENUMs;
-- we recreate them in the same statement below.
DROP TYPE IF EXISTS meeting_status     CASCADE;
DROP TYPE IF EXISTS meeting_platform   CASCADE;
DROP TYPE IF EXISTS task_status        CASCADE;
DROP TYPE IF EXISTS task_priority      CASCADE;
DROP TYPE IF EXISTS user_role          CASCADE;
DROP TYPE IF EXISTS bot_status         CASCADE;
DROP TYPE IF EXISTS upload_status      CASCADE;
DROP TYPE IF EXISTS notification_type  CASCADE;
DROP TYPE IF EXISTS log_level          CASCADE;


-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE meeting_status AS ENUM (
  'scheduled','joining','recording','processing',
  'transcribing','summarising','complete','failed','partial'
);
CREATE TYPE meeting_platform AS ENUM (
  'zoom','google_meet','teams','webex','upload','other'
);
CREATE TYPE task_status AS ENUM (
  'Open','In Progress','Completed','Cancelled'
);
CREATE TYPE task_priority AS ENUM (
  'High','Medium','Low'
);
CREATE TYPE user_role AS ENUM (
  'admin','member','viewer'
);
CREATE TYPE bot_status AS ENUM (
  'idle','joining','recording','processing','complete','failed'
);
CREATE TYPE upload_status AS ENUM (
  'queued','uploading','processing','complete','failed'
);
CREATE TYPE notification_type AS ENUM (
  'success','warning','error','info'
);
CREATE TYPE log_level AS ENUM (
  'DEBUG','INFO','WARN','ERROR','CRITICAL'
);


-- ============================================================
-- TABLE: users
-- Extends Supabase auth.users - no passwords stored here.
-- student_id column removed from this version.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL UNIQUE,
  first_name   TEXT,
  last_name    TEXT,
  organisation TEXT,
  timezone     TEXT        NOT NULL DEFAULT 'UTC',
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remove student_id if it survived from the old schema
ALTER TABLE public.users DROP COLUMN IF EXISTS student_id;

COMMENT ON TABLE public.users IS 'User profiles linked to Supabase auth - Supabase handles passwords';


-- ============================================================
-- TABLE: workspaces
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspaces (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT        NOT NULL,
  owner_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  plan       TEXT        NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.workspaces IS 'Team workspaces - one per organisation or project group';


-- ============================================================
-- TABLE: workspace_members
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id           UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID      NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID      NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  role         user_role NOT NULL DEFAULT 'member',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

COMMENT ON TABLE public.workspace_members IS 'Membership linking users to workspaces with roles';



-- ============================================================
-- TABLE: meetings
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meetings (
  id                UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id      UUID             NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id          UUID             REFERENCES public.users(id) ON DELETE SET NULL,
  title             TEXT,
  platform          meeting_platform NOT NULL DEFAULT 'zoom',
  meeting_url       TEXT,
  external_id       TEXT,
  status            meeting_status   NOT NULL DEFAULT 'scheduled',
  audio_path        TEXT,
  transcript        TEXT,
  summary           TEXT,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  participant_count INTEGER          DEFAULT 0,
  task_count        INTEGER          DEFAULT 0,
  transcribed_at    TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);



COMMENT ON TABLE public.meetings IS 'All meeting records - bot joins, uploads, and calendar syncs';


-- ============================================================
-- TABLE: meeting_participants
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id    UUID        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  display_name  TEXT        NOT NULL,
  email         TEXT,
  speaker_label TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.meeting_participants IS 'Participants per meeting - internal users and external guests';


-- ============================================================
-- TABLE: meeting_highlights
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meeting_highlights (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.meeting_highlights IS 'Ordered AI-extracted key points per meeting';


-- ============================================================
-- TABLE: bots
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bots (
  id              UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID             NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id         UUID             NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  meeting_id      UUID             REFERENCES public.meetings(id) ON DELETE SET NULL,
  platform        meeting_platform NOT NULL DEFAULT 'zoom',
  meeting_url     TEXT             NOT NULL,
  status          bot_status       NOT NULL DEFAULT 'idle',
  bot_instance_id TEXT,
  error_message   TEXT,
  started_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);


COMMENT ON TABLE public.bots IS 'Bot deployment sessions - one row per live recording bot';


-- ============================================================
-- TABLE: uploads
-- ============================================================

CREATE TABLE IF NOT EXISTS public.uploads (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID          NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  meeting_id    UUID          REFERENCES public.meetings(id) ON DELETE SET NULL,
  file_name     TEXT          NOT NULL,
  file_path     TEXT          NOT NULL,
  mime_type     TEXT          NOT NULL,
  size_bytes    BIGINT        NOT NULL,
  status        upload_status NOT NULL DEFAULT 'queued',
  error_message TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


COMMENT ON TABLE public.uploads IS 'Manual file upload records - audio, video, or text transcripts';


-- ============================================================
-- TABLE: tasks
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tasks (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID          NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  meeting_id    UUID          REFERENCES public.meetings(id) ON DELETE CASCADE,
  created_by    UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  assignee_id   UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  assignee_name TEXT,
  title         TEXT          NOT NULL,
  description   TEXT,
  priority      task_priority NOT NULL DEFAULT 'Medium',
  status        task_status   NOT NULL DEFAULT 'Open',
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  ai_extracted  BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


COMMENT ON TABLE public.tasks IS 'Action items - AI-extracted or manually created, linked to meetings';


-- ============================================================
-- TABLE: user_preferences
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id                     UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID    NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  theme                  TEXT    NOT NULL DEFAULT 'dark',
  email_summaries        BOOLEAN NOT NULL DEFAULT TRUE,
  email_task_reminders   BOOLEAN NOT NULL DEFAULT TRUE,
  email_weekly_digest    BOOLEAN NOT NULL DEFAULT FALSE,
  email_mentions         BOOLEAN NOT NULL DEFAULT TRUE,
  email_bot_status       BOOLEAN NOT NULL DEFAULT TRUE,
  bot_auto_join          BOOLEAN NOT NULL DEFAULT FALSE,
  bot_auto_summarise     BOOLEAN NOT NULL DEFAULT TRUE,
  bot_email_participants BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


COMMENT ON TABLE public.user_preferences IS 'Per-user notification and bot behaviour settings';


-- ============================================================
-- TABLE: notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID              NOT NULL REFERENCES public.users(id)       ON DELETE CASCADE,
  workspace_id UUID              REFERENCES public.workspaces(id)           ON DELETE CASCADE,
  type         notification_type NOT NULL DEFAULT 'info',
  title        TEXT              NOT NULL,
  body         TEXT,
  link         TEXT,
  read         BOOLEAN           NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);


COMMENT ON TABLE public.notifications IS 'In-app notification inbox per user';


-- ============================================================
-- TABLE: system_logs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_logs (
  id           UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  level        log_level NOT NULL DEFAULT 'INFO',
  message      TEXT      NOT NULL,
  context      JSONB,
  user_id      UUID      REFERENCES public.users(id)      ON DELETE SET NULL,
  workspace_id UUID      REFERENCES public.workspaces(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.system_logs IS 'Server-side error and event log - backend service role only';


-- ============================================================
-- TABLE: audit_logs  (append-only - never update/delete rows)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id           UUID   PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID   REFERENCES public.users(id)      ON DELETE SET NULL,
  workspace_id UUID   REFERENCES public.workspaces(id) ON DELETE SET NULL,
  action       TEXT   NOT NULL,
  entity_type  TEXT,
  entity_id    UUID,
  payload      JSONB,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.audit_logs IS 'Immutable audit trail - never update or delete rows here';


-- ============================================================
-- DEFENSIVE COLUMN MIGRATION
-- Every column every table needs - safe to run on old or new DB.
-- ADD COLUMN IF NOT EXISTS is a no-op if the column already exists.
-- Run this BEFORE indexes, triggers, RLS, and views.
-- ============================================================

-- workspaces
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS name       TEXT        NOT NULL DEFAULT 'My Workspace';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS owner_id   UUID        REFERENCES public.users(id) ON DELETE RESTRICT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS plan       TEXT        NOT NULL DEFAULT 'free';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- workspace_members
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS workspace_id UUID        REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS user_id      UUID        REFERENCES public.users(id)      ON DELETE CASCADE;
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS role         TEXT        NOT NULL DEFAULT 'member';
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email        TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name   TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name    TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organisation TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS timezone     TEXT        NOT NULL DEFAULT 'UTC';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url   TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Remove old columns no longer in schema
ALTER TABLE public.users DROP COLUMN IF EXISTS student_id;

-- meetings
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS workspace_id      UUID             REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS owner_id          UUID             REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS title             TEXT;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS platform          TEXT             NOT NULL DEFAULT 'zoom';
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS meeting_url       TEXT;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS external_id       TEXT;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS status            TEXT             NOT NULL DEFAULT 'scheduled';
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS audio_path        TEXT;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS transcript        TEXT;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS summary           TEXT;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS ended_at          TIMESTAMPTZ;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS duration_secs     INTEGER;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS participant_count INTEGER          DEFAULT 0;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS task_count        INTEGER          DEFAULT 0;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS transcribed_at    TIMESTAMPTZ;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS processed_at      TIMESTAMPTZ;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW();
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW();

-- meeting_participants
ALTER TABLE public.meeting_participants ADD COLUMN IF NOT EXISTS meeting_id    UUID        REFERENCES public.meetings(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_participants ADD COLUMN IF NOT EXISTS user_id       UUID        REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.meeting_participants ADD COLUMN IF NOT EXISTS display_name  TEXT;
ALTER TABLE public.meeting_participants ADD COLUMN IF NOT EXISTS email         TEXT;
ALTER TABLE public.meeting_participants ADD COLUMN IF NOT EXISTS speaker_label TEXT;
ALTER TABLE public.meeting_participants ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- meeting_highlights
ALTER TABLE public.meeting_highlights ADD COLUMN IF NOT EXISTS meeting_id  UUID        REFERENCES public.meetings(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_highlights ADD COLUMN IF NOT EXISTS sort_order  INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE public.meeting_highlights ADD COLUMN IF NOT EXISTS content     TEXT;
ALTER TABLE public.meeting_highlights ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- bots
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS workspace_id    UUID             REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS user_id         UUID             REFERENCES public.users(id)      ON DELETE CASCADE;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS meeting_id      UUID             REFERENCES public.meetings(id)   ON DELETE SET NULL;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS platform        TEXT             NOT NULL DEFAULT 'zoom';
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS meeting_url     TEXT;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS status          TEXT             NOT NULL DEFAULT 'idle';
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS bot_instance_id TEXT;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS error_message   TEXT;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW();
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS ended_at        TIMESTAMPTZ;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW();
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW();

-- uploads
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS workspace_id  UUID          REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS user_id       UUID          REFERENCES public.users(id)      ON DELETE CASCADE;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS meeting_id    UUID          REFERENCES public.meetings(id)   ON DELETE SET NULL;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS file_name     TEXT;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS file_path     TEXT;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS mime_type     TEXT;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS size_bytes    BIGINT;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS status        TEXT          NOT NULL DEFAULT 'queued';
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW();
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- tasks
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS workspace_id  UUID          REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS meeting_id    UUID          REFERENCES public.meetings(id)   ON DELETE CASCADE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by    UUID          REFERENCES public.users(id)      ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignee_id   UUID          REFERENCES public.users(id)      ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS title         TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS description   TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority      TEXT          NOT NULL DEFAULT 'Medium';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status        TEXT          NOT NULL DEFAULT 'Open';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_date      DATE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS ai_extracted  BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW();
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- user_preferences
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS user_id                UUID        REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS theme                  TEXT        NOT NULL DEFAULT 'dark';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS email_summaries        BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS email_task_reminders   BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS email_weekly_digest    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS email_mentions         BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS email_bot_status       BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS bot_auto_join          BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS bot_auto_summarise     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS bot_email_participants BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- notifications
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id      UUID              REFERENCES public.users(id)       ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS workspace_id UUID              REFERENCES public.workspaces(id)  ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type         TEXT              NOT NULL DEFAULT 'info';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title        TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body         TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link         TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read         BOOLEAN           NOT NULL DEFAULT FALSE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ       NOT NULL DEFAULT NOW();

-- system_logs
ALTER TABLE public.system_logs ADD COLUMN IF NOT EXISTS level        TEXT        NOT NULL DEFAULT 'INFO';
ALTER TABLE public.system_logs ADD COLUMN IF NOT EXISTS message      TEXT;
ALTER TABLE public.system_logs ADD COLUMN IF NOT EXISTS context      JSONB;
ALTER TABLE public.system_logs ADD COLUMN IF NOT EXISTS user_id      UUID        REFERENCES public.users(id)      ON DELETE SET NULL;
ALTER TABLE public.system_logs ADD COLUMN IF NOT EXISTS workspace_id UUID        REFERENCES public.workspaces(id) ON DELETE SET NULL;
ALTER TABLE public.system_logs ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- audit_logs
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_id      UUID        REFERENCES public.users(id)      ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS workspace_id UUID        REFERENCES public.workspaces(id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action       TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_type  TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_id    UUID;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS payload      JSONB;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip_address   INET;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ============================================================
-- INDEXES
-- Drop first so re-runs do not error on duplicates
-- ============================================================

DROP INDEX IF EXISTS idx_meetings_workspace;
DROP INDEX IF EXISTS idx_meetings_owner;
DROP INDEX IF EXISTS idx_meetings_status;
DROP INDEX IF EXISTS idx_meetings_created;
DROP INDEX IF EXISTS idx_meetings_platform;
DROP INDEX IF EXISTS idx_meetings_fts;
DROP INDEX IF EXISTS idx_meetings_title_trgm;
DROP INDEX IF EXISTS idx_tasks_workspace;
DROP INDEX IF EXISTS idx_tasks_meeting;
DROP INDEX IF EXISTS idx_tasks_assignee;
DROP INDEX IF EXISTS idx_tasks_status;
DROP INDEX IF EXISTS idx_tasks_priority;
DROP INDEX IF EXISTS idx_tasks_due_date;
DROP INDEX IF EXISTS idx_tasks_created;
DROP INDEX IF EXISTS idx_tasks_fts;
DROP INDEX IF EXISTS idx_tasks_title_trgm;
DROP INDEX IF EXISTS idx_bots_workspace;
DROP INDEX IF EXISTS idx_bots_status;
DROP INDEX IF EXISTS idx_bots_user;
DROP INDEX IF EXISTS idx_notifications_user;
DROP INDEX IF EXISTS idx_notifications_unread;
DROP INDEX IF EXISTS idx_notifications_created;
DROP INDEX IF EXISTS idx_audit_user;
DROP INDEX IF EXISTS idx_audit_created;
DROP INDEX IF EXISTS idx_syslog_level;
DROP INDEX IF EXISTS idx_wm_workspace;
DROP INDEX IF EXISTS idx_wm_user;

-- meetings
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meetings' AND column_name='workspace_id') THEN
    CREATE INDEX IF NOT EXISTS idx_meetings_workspace  ON public.meetings(workspace_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_meetings_owner      ON public.meetings(owner_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status     ON public.meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_created    ON public.meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_platform   ON public.meetings(platform);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meetings' AND column_name='title') THEN
    CREATE INDEX IF NOT EXISTS idx_meetings_fts ON public.meetings USING GIN (
      to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(summary,'') || ' ' || COALESCE(transcript,''))
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_title_trgm ON public.meetings USING GIN (title gin_trgm_ops);
  END IF;
END $$;

-- tasks
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tasks' AND column_name='workspace_id') THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON public.tasks(workspace_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tasks_meeting       ON public.tasks(meeting_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee      ON public.tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status        ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority      ON public.tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date      ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_created       ON public.tasks(created_at DESC);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tasks' AND column_name='description') THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_fts ON public.tasks USING GIN (
      to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(description,''))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON public.tasks USING GIN (title gin_trgm_ops);
  END IF;
END $$;

-- bots
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bots' AND column_name='workspace_id') THEN
    CREATE INDEX IF NOT EXISTS idx_bots_workspace ON public.bots(workspace_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bots_status         ON public.bots(status);
CREATE INDEX IF NOT EXISTS idx_bots_user           ON public.bots(user_id);

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread  ON public.notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);

-- logs
CREATE INDEX IF NOT EXISTS idx_audit_user    ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_syslog_level  ON public.system_logs(level, created_at DESC);

-- workspace_members
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON public.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wm_user      ON public.workspace_members(user_id);


-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Apply to all tables that have updated_at
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','workspaces','meetings','tasks','bots','uploads','user_preferences'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%s;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON public.%s
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      t, t, t, t
    );
  END LOOP;
END $$;


-- Auto-create profile + preferences on signup
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_created ON auth.users;
CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();


-- Keep task_count on meetings accurate
CREATE OR REPLACE FUNCTION public.sync_meeting_task_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.meeting_id IS NOT NULL THEN
    UPDATE public.meetings SET task_count = task_count + 1 WHERE id = NEW.meeting_id;
  ELSIF TG_OP = 'DELETE' AND OLD.meeting_id IS NOT NULL THEN
    UPDATE public.meetings SET task_count = GREATEST(task_count - 1, 0) WHERE id = OLD.meeting_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_count_sync ON public.tasks;
CREATE TRIGGER trg_task_count_sync
  AFTER INSERT OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_meeting_task_count();


-- Sync duration_secs whenever started_at or ended_at changes
CREATE OR REPLACE FUNCTION public.sync_meeting_duration()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
    NEW.duration_secs = EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at))::INTEGER;
  ELSE
    NEW.duration_secs = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_duration ON public.meetings;
CREATE TRIGGER trg_meeting_duration
  BEFORE INSERT OR UPDATE OF started_at, ended_at ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.sync_meeting_duration();


-- Auto-set completed_at when task flips to Completed
CREATE OR REPLACE FUNCTION public.handle_task_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status <> 'Completed' THEN
    NEW.completed_at = NOW();
  ELSIF NEW.status <> 'Completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_completed_at ON public.tasks;
CREATE TRIGGER trg_task_completed_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_task_completion();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_highlights   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bots                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs           ENABLE ROW LEVEL SECURITY;


-- Helper functions
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND role = 'admin'
  );
$$;


-- Drop all existing policies before recreating (safe re-run)
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;


-- users
CREATE POLICY "users_select_own" ON public.users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (id = auth.uid());

-- workspaces
CREATE POLICY "workspaces_select" ON public.workspaces FOR SELECT USING (public.is_workspace_member(id));
CREATE POLICY "workspaces_insert" ON public.workspaces FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "workspaces_update" ON public.workspaces FOR UPDATE USING (public.is_workspace_admin(id));
CREATE POLICY "workspaces_delete" ON public.workspaces FOR DELETE USING (owner_id = auth.uid());

-- workspace_members
CREATE POLICY "wm_select" ON public.workspace_members FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "wm_insert" ON public.workspace_members FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id) OR user_id = auth.uid());
CREATE POLICY "wm_delete" ON public.workspace_members FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- meetings
CREATE POLICY "meetings_select" ON public.meetings FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "meetings_insert" ON public.meetings FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "meetings_update" ON public.meetings FOR UPDATE USING (public.is_workspace_member(workspace_id));
CREATE POLICY "meetings_delete" ON public.meetings FOR DELETE USING (public.is_workspace_admin(workspace_id) OR owner_id = auth.uid());

-- meeting_participants
CREATE POLICY "mp_select" ON public.meeting_participants FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND public.is_workspace_member(m.workspace_id))
);
CREATE POLICY "mp_insert" ON public.meeting_participants FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND public.is_workspace_member(m.workspace_id))
);

-- meeting_highlights
CREATE POLICY "mh_select" ON public.meeting_highlights FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND public.is_workspace_member(m.workspace_id))
);
CREATE POLICY "mh_insert" ON public.meeting_highlights FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND public.is_workspace_member(m.workspace_id))
);

-- tasks
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE USING (public.is_workspace_member(workspace_id));
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE USING (public.is_workspace_admin(workspace_id) OR created_by = auth.uid());

-- bots
CREATE POLICY "bots_select" ON public.bots FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "bots_insert" ON public.bots FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "bots_update" ON public.bots FOR UPDATE USING (public.is_workspace_member(workspace_id));

-- uploads
CREATE POLICY "uploads_select" ON public.uploads FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "uploads_insert" ON public.uploads FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

-- user_preferences
CREATE POLICY "prefs_select" ON public.user_preferences FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "prefs_insert" ON public.user_preferences FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "prefs_update" ON public.user_preferences FOR UPDATE USING (user_id = auth.uid());

-- notifications
CREATE POLICY "notifs_select" ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notifs_update" ON public.notifications FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "notifs_delete" ON public.notifications FOR DELETE USING (user_id = auth.uid());

-- logs: backend only - deny all direct user access
CREATE POLICY "syslog_deny" ON public.system_logs FOR ALL USING (FALSE);
CREATE POLICY "audit_deny"  ON public.audit_logs  FOR ALL USING (FALSE);


-- ============================================================
-- REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;


-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW public.workspace_stats AS
SELECT
  w.id                                                                            AS workspace_id,
  w.name                                                                          AS workspace_name,
  COUNT(DISTINCT m.id)                                                            AS total_meetings,
  COUNT(DISTINCT m.id) FILTER (WHERE m.created_at >= NOW() - INTERVAL '30 days') AS meetings_this_month,
  COUNT(DISTINCT t.id)                                                            AS total_tasks,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'Open')                          AS open_tasks,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'In Progress')                   AS in_progress_tasks,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'Completed')                     AS completed_tasks,
  ROUND(
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'Completed')::NUMERIC
    / NULLIF(COUNT(DISTINCT t.id), 0) * 100, 1
  )                                                                               AS completion_rate_pct,
  COUNT(DISTINCT wm.user_id)                                                      AS member_count
FROM public.workspaces w
LEFT JOIN public.meetings          m  ON m.workspace_id  = w.id
LEFT JOIN public.tasks             t  ON t.workspace_id  = w.id
LEFT JOIN public.workspace_members wm ON wm.workspace_id = w.id
GROUP BY w.id, w.name;

COMMENT ON VIEW public.workspace_stats IS 'KPI aggregates per workspace - powers the dashboard stat cards';


CREATE OR REPLACE VIEW public.meetings_summary AS
SELECT
  m.id, m.workspace_id, m.title, m.platform, m.status,
  m.started_at, m.ended_at, m.duration_secs,
  m.participant_count, m.task_count,
  m.created_at, m.updated_at,
  u.first_name || ' ' || COALESCE(u.last_name, '') AS owner_name
FROM public.meetings m
LEFT JOIN public.users u ON u.id = m.owner_id;

COMMENT ON VIEW public.meetings_summary IS 'Meetings with resolved owner name - for dashboard and meeting list';


CREATE OR REPLACE VIEW public.tasks_detail AS
SELECT
  t.id, t.workspace_id, t.meeting_id,
  m.title AS meeting_title,
  t.title, t.description, t.priority, t.status,
  t.due_date, t.completed_at, t.ai_extracted,
  t.created_at, t.updated_at,
  COALESCE(
    u.first_name || ' ' || COALESCE(u.last_name, ''),
    t.assignee_name,
    'Unassigned'
  ) AS assignee_display,
  t.assignee_id
FROM public.tasks t
LEFT JOIN public.meetings m ON m.id = t.meeting_id
LEFT JOIN public.users    u ON u.id = t.assignee_id;

COMMENT ON VIEW public.tasks_detail IS 'Tasks with meeting title and assignee name - for tasks page and meeting summary';


-- ============================================================
-- SEARCH FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_workspace(
  p_workspace_id UUID,
  p_query        TEXT,
  p_limit        INT DEFAULT 20
)
RETURNS TABLE (
  result_type TEXT,
  id          UUID,
  title       TEXT,
  snippet     TEXT,
  rank        REAL,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
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
$$;

COMMENT ON FUNCTION public.search_workspace IS 'Full-text search across meetings and tasks - call via supabase.rpc()';


-- ============================================================
-- ALL DONE - safe to re-run at any time
-- ============================================================