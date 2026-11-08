alter table public.collections
  add constraint collections_id_owner_unique unique (id, owner_id);

alter table public.notes
  add column owner_id uuid,
  add column deleted_at timestamptz;

update public.notes n
set owner_id = c.owner_id
from public.collections c
where c.id = n.collection_id;

alter table public.notes
  alter column owner_id set default auth.uid(),
  alter column owner_id set not null,
  add constraint notes_collection_owner_fk foreign key (collection_id, owner_id)
    references public.collections (id, owner_id) on delete cascade;

-- Keep the oldest note's name and give each existing duplicate a free suffix.
do $$
declare
  duplicate record;
  suffix_number integer;
  suffix text;
  candidate text;
begin
  for duplicate in
    select id, owner_id, title from (
      select id, owner_id, title, created_at, row_number() over (
        partition by owner_id, lower(btrim(title)) order by created_at, id
      ) as position
      from public.notes
    ) ranked
    where position > 1
    order by created_at, id
  loop
    suffix_number := 2;
    loop
      suffix := ' (' || suffix_number || ')';
      candidate := rtrim(left(btrim(duplicate.title), 160 - char_length(suffix))) || suffix;
      exit when not exists (
        select 1 from public.notes
        where owner_id = duplicate.owner_id and lower(btrim(title)) = lower(candidate)
      );
      suffix_number := suffix_number + 1;
    end loop;
    update public.notes set title = candidate where id = duplicate.id;
  end loop;
end;
$$;

create unique index notes_owner_title_unique
  on public.notes (owner_id, lower(btrim(title)))
  where deleted_at is null;

grant delete on public.notes to authenticated;

create policy "Only marked notes can be deleted" on public.notes
  as restrictive for delete to authenticated
  using (deleted_at is not null);
