create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key,
  collection_id uuid not null references public.collections(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  cover_path text,
  created_at timestamptz not null default now()
);

create table public.note_pages (
  note_id uuid not null references public.notes(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  image_path text,
  page_ratio double precision not null check (page_ratio > 0 and page_ratio < 'Infinity'::double precision),
  strokes jsonb not null default '[]'::jsonb check (jsonb_typeof(strokes) = 'array'),
  primary key (note_id, page_number)
);

create index collections_owner_id_idx on public.collections(owner_id);
create index notes_collection_id_idx on public.notes(collection_id);

alter table public.collections enable row level security;
alter table public.notes enable row level security;
alter table public.note_pages enable row level security;

create policy "Owners manage collections" on public.collections for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners manage notes" on public.notes for all to authenticated
  using (exists (select 1 from public.collections where id = collection_id and owner_id = (select auth.uid())))
  with check (exists (select 1 from public.collections where id = collection_id and owner_id = (select auth.uid())));

create policy "Owners manage note pages" on public.note_pages for all to authenticated
  using (exists (
    select 1 from public.notes join public.collections on collections.id = notes.collection_id
    where notes.id = note_id and collections.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.notes join public.collections on collections.id = notes.collection_id
    where notes.id = note_id and collections.owner_id = (select auth.uid())
  ));

grant select, insert, update on public.collections, public.notes, public.note_pages to authenticated;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('note-images', 'note-images', false, array['image/jpeg'], 10485760);

create policy "Owners manage note images" on storage.objects for all to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create function public.create_note(
  p_id uuid,
  p_collection_id uuid,
  p_title text,
  p_cover_path text,
  p_image_path text,
  p_page_ratio double precision
) returns setof public.notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_note public.notes;
begin
  insert into public.notes (id, collection_id, title, cover_path)
  values (p_id, p_collection_id, trim(p_title), p_cover_path)
  on conflict (id) do update set title = excluded.title
  where notes.collection_id = excluded.collection_id
    and notes.cover_path is not distinct from excluded.cover_path
  returning * into saved_note;

  if not found then
    raise exception 'Note already exists in a different collection';
  end if;

  insert into public.note_pages (note_id, page_number, image_path, page_ratio)
  values (p_id, 1, p_image_path, p_page_ratio)
  on conflict (note_id, page_number) do nothing;

  return next saved_note;
end;
$$;

revoke execute on function public.create_note(uuid, uuid, text, text, text, double precision) from public, anon;
grant execute on function public.create_note(uuid, uuid, text, text, text, double precision) to authenticated;
