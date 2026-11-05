create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  act text;
  details jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then rec := old; else rec := new; end if;

  if tg_table_name = 'meetings' then
    if tg_op = 'DELETE' then
      act := 'meeting.deleted';
      details := jsonb_build_object('title', old.title);
    elsif tg_op = 'UPDATE' and new.summary is distinct from old.summary and old.summary is not null then
      act := 'meeting.summary_edited';
      details := jsonb_build_object('title', new.title, 'previous', old.summary);
    elsif tg_op = 'INSERT' then
      act := 'meeting.created';
      details := jsonb_build_object('title', new.title, 'platform', new.platform);
    else
      return rec;
    end if;
  elsif tg_table_name = 'tasks' then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      act := 'task.status_changed';
      details := jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status);
    elsif tg_op = 'DELETE' then
      act := 'task.deleted';
      details := jsonb_build_object('title', old.title);
    elsif tg_op = 'INSERT' then
      act := 'task.created';
      details := jsonb_build_object('title', new.title);
    else
      return rec;
    end if;
  elsif tg_table_name = 'workspace_members' then
    act := case tg_op when 'INSERT' then 'member.added' when 'DELETE' then 'member.removed' else 'member.role_changed' end;
    details := jsonb_build_object('member', rec.user_id, 'role', rec.role);
  else
    return rec;
  end if;

  if rec.workspace_id is null or not exists (select 1 from workspaces w where w.id = rec.workspace_id) then
    return rec;
  end if;

  insert into audit_logs (user_id, workspace_id, action, entity_type, entity_id, payload)
  values (auth.uid(), rec.workspace_id, act, tg_table_name, rec.id, details);
  return rec;
end;
$$;

drop trigger if exists trg_audit_meetings on public.meetings;
create trigger trg_audit_meetings after insert or update or delete on public.meetings
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_tasks on public.tasks;
create trigger trg_audit_tasks after insert or update or delete on public.tasks
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_members on public.workspace_members;
create trigger trg_audit_members after insert or update of role or delete on public.workspace_members
  for each row execute function public.write_audit_log();

drop policy if exists audit_admin_read on public.audit_logs;
drop policy if exists audit_member_read on public.audit_logs;
create policy audit_member_read on public.audit_logs
  for select using (workspace_id is not null and is_workspace_member(workspace_id));
