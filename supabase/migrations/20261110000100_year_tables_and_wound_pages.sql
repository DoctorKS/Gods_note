alter table public.collections
  add column buddhist_year integer check (buddhist_year between 2400 and 2600),
  add constraint collections_owner_year_unique unique (owner_id, buddhist_year);

alter table public.note_pages
  add column kind text not null default 'document' check (kind in ('document', 'wound'));

create function public.append_wound_pages(p_note_id uuid, p_images text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_number integer;
  photo_path text;
  prefix text := (select auth.uid())::text || '/' || p_note_id::text || '/wound-';
begin
  if coalesce(cardinality(p_images), 0) not between 1 and 10 then
    raise exception 'Choose 1 to 10 wound photos.';
  end if;

  perform 1 from public.notes where id = p_note_id and deleted_at is null for update;
  if not found then
    raise exception 'This document is unavailable.';
  end if;

  select coalesce(max(page_number), 0) + 1 into next_number
  from public.note_pages where note_id = p_note_id;

  foreach photo_path in array p_images loop
    if photo_path is null or prefix is null or left(photo_path, length(prefix)) <> prefix
      or substring(photo_path from length(prefix) + 1) !~ '^[0-9a-f-]{36}\.jpg$' then
      raise exception 'Invalid wound photo path.';
    end if;
    if not exists (select 1 from public.note_pages p where p.note_id = p_note_id and p.image_path = photo_path) then
      insert into public.note_pages (note_id, page_number, image_path, page_ratio, kind)
      values (p_note_id, next_number, photo_path, 210.0 / 297.0, 'wound');
      next_number := next_number + 1;
    end if;
  end loop;
end;
$$;

create function public.create_note_with_wounds(
  p_id uuid,
  p_collection_id uuid,
  p_title text,
  p_cover_path text,
  p_image_path text,
  p_page_ratio double precision,
  p_wounds text[]
) returns setof public.notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_note public.notes;
begin
  select * into strict saved_note from public.create_note(
    p_id, p_collection_id, p_title, p_cover_path, p_image_path, p_page_ratio
  );
  perform public.append_wound_pages(p_id, p_wounds);
  return next saved_note;
end;
$$;

revoke execute on function public.append_wound_pages(uuid, text[]) from public, anon;
revoke execute on function public.create_note_with_wounds(uuid, uuid, text, text, text, double precision, text[]) from public, anon;
grant execute on function public.append_wound_pages(uuid, text[]) to authenticated;
grant execute on function public.create_note_with_wounds(uuid, uuid, text, text, text, double precision, text[]) to authenticated;
