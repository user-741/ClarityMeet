create or replace function public.log_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  insert into audit_logs (user_id, workspace_id, action, entity_type, entity_id, payload)
  select auth.uid(), wm.workspace_id, 'user.login', 'users', auth.uid(), '{}'::jsonb
  from workspace_members wm where wm.user_id = auth.uid();
end;
$$;

revoke all on function public.log_login() from public;
grant execute on function public.log_login() to authenticated;
