-- An absent safe display name is semantic absence. Clients localize that placeholder.
-- An authored display name exactly equal to Membro remains untouched.
create or replace function public.renew_page_presence(p_page_id uuid,p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_workspace uuid;v_epoch bigint;v_expiry timestamptz:=clock_timestamp()+interval '30 seconds';v_participants jsonb;
begin
  if p_participant_id is null then raise exception 'Invalid participant' using errcode='22023'; end if;
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  perform 1 from public.workspaces where id=v_workspace for update;
  if private.page_role(p_page_id,v_actor) is null then raise exception 'Page unavailable' using errcode='42501'; end if;
  perform private.collaboration_rate(v_workspace,v_actor,'presence');
  delete from private.page_presence_leases where (page_id,participant_id) in (
    select page_id,participant_id from private.page_presence_leases where workspace_id=v_workspace and actor_id=v_actor and expires_at<=clock_timestamp()
    order by expires_at limit 64);
  if exists(select 1 from private.page_presence_leases where page_id=p_page_id and participant_id=p_participant_id and actor_id<>v_actor) then
    raise exception 'Participant unavailable' using errcode='42501'; end if;
  if not exists(select 1 from private.page_presence_leases where page_id=p_page_id and participant_id=p_participant_id and actor_id=v_actor and expires_at>clock_timestamp()) then
    if (select count(*) from private.page_presence_leases where workspace_id=v_workspace and actor_id=v_actor and expires_at>clock_timestamp())>=8
      or (select count(*) from private.page_presence_leases where page_id=p_page_id and expires_at>clock_timestamp())>=256 then
      raise exception 'Presence capacity exceeded' using errcode='54000'; end if;
  end if;
  insert into private.page_presence_epochs(workspace_id) values(v_workspace) on conflict do nothing;
  select epoch into v_epoch from private.page_presence_epochs where workspace_id=v_workspace;
  v_expiry:=clock_timestamp()+interval '30 seconds';
  insert into private.page_presence_leases(workspace_id,page_id,participant_id,actor_id,epoch,expires_at)
    values(v_workspace,p_page_id,p_participant_id,v_actor,v_epoch,v_expiry)
    on conflict(page_id,participant_id) do update set epoch=excluded.epoch,expires_at=excluded.expires_at;
  select coalesce(jsonb_agg(jsonb_build_object('participantId',l.participant_id,'label',
    case when n.name='' or position('@' in n.name)>0 then '' else n.name end,'expiresAt',l.expires_at) order by l.participant_id),'[]')
    into v_participants from private.page_presence_leases l join auth.users u on u.id=l.actor_id
    cross join lateral(select left(btrim(coalesce(nullif(u.raw_user_meta_data->>'display_name',''),u.raw_user_meta_data->>'name','')),120) name) n
    where l.page_id=p_page_id and l.epoch=v_epoch and l.expires_at>clock_timestamp();
  return jsonb_build_object('epoch',v_epoch,'expiresAt',v_expiry,'participants',v_participants);
end;
$$;
create or replace function private.comment_label(p_metadata jsonb)
returns text language sql immutable set search_path='' as $$
  select case when name='' or position('@' in name)>0 then '' else name end
  from(select left(btrim(coalesce(nullif(p_metadata->>'display_name',''),p_metadata->>'name','')),120) name) n;
$$;
create or replace function private.sharing_member_label(p_user_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when n.name='' or position('@' in n.name)>0 then '' else n.name end from auth.users u
  cross join lateral(select left(regexp_replace(btrim(coalesce(nullif(u.raw_user_meta_data->>'display_name',''),u.raw_user_meta_data->>'name','')),'[[:cntrl:]]','','g'),120) name) n where u.id=p_user_id;
$$;
