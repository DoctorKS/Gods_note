import { createClient } from "@supabase/supabase-js";
import { get, update } from "idb-keyval";
import {
  A4_HEIGHT, A4_WIDTH, assertNoteNameAvailable, DEFAULT_PAGE_RATIO, DuplicateNoteNameError,
  MAX_BATCH_IMAGES, MAX_UPLOAD_BYTES, MAX_WOUND_BYTES, YEAR_TABLE_IN_TRASH,
  type Collection, type Library, type Note, type NotePage, type NoteRepository, type WoundPhoto,
} from "./models";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = projectUrl && publishableKey ? createClient(projectUrl, publishableKey) : null;

type NoteRow = { id: string; collection_id: string; title: string; created_at: string; cover_path: string | null; deleted_at: string | null };
type CollectionRow = { id: string; title: string; buddhist_year: number | null; trashed_at: string | null };
type PageRow = { page_number: number; kind: NotePage["kind"]; image_path: string | null; page_ratio: number; strokes: NotePage["strokes"] };
type ApiError = { message: string; code?: string };
const collectionColumns = "id,title,buddhist_year,trashed_at";

function fromCollectionRow({ id, title, buddhist_year, trashed_at }: CollectionRow): Collection {
  return { id, title, year: buddhist_year ?? undefined, trashedAt: trashed_at ?? undefined };
}

function validateWoundPhotos(photos: WoundPhoto[]) {
  if (!photos.length || photos.length > MAX_BATCH_IMAGES) throw new Error("Choose 1 to 10 wound photos.");
  if (photos.some(({ image }) => image.type !== "image/jpeg" || image.size > MAX_WOUND_BYTES)) {
    throw new Error("Each wound photo must be a JPEG of 200 KB or less.");
  }
}

function fromNoteRow(row: NoteRow): Note {
  return { id: row.id, collectionId: row.collection_id, title: row.title, createdAt: row.created_at, cover: row.cover_path };
}

function unwrap<T>({ data, error }: { data: T | null; error: ApiError | null }): T {
  if (error?.code === "23505" && error.message.includes("notes_owner_title_unique")) throw new DuplicateNoteNameError();
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Supabase did not return data.");
  return data;
}

async function readPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  const size = 200;
  for (let from = 0; ; from += size) {
    const page = unwrap(await read(from, from + size - 1));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

export function cloudRepository(owner: string): NoteRepository {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const images = client.storage.from("note-images");
  const noteFolder = (id: string) => `${owner}/${id}`;

  async function removeNoteImages(id: string) {
    const folder = noteFolder(id);
    const files = await readPages((from, to) => images.list(folder, {
      offset: from, limit: to - from + 1, sortBy: { column: "name", order: "asc" },
    }));
    const paths = files.map(({ name }) => `${folder}/${name}`);
    for (let from = 0; from < paths.length; from += 200) {
      unwrap(await images.remove(paths.slice(from, from + 200)));
    }
  }

  async function uploadWoundPhotos(id: string, photos: WoundPhoto[]) {
    const paths: string[] = [];
    for (const { id: photoId, image } of photos) {
      const path = `${noteFolder(id)}/wound-${photoId}.jpg`;
      unwrap(await images.upload(path, image, { upsert: true, contentType: "image/jpeg" }));
      paths.push(path);
    }
    return paths;
  }

  const finishDelete = async (id: string) => {
    await removeNoteImages(id);
    const { error } = await client.from("notes").delete().eq("id", id).not("deleted_at", "is", null);
    if (error) throw new Error(error.message);
  };

  return {
    async list() {
      const [collections, notes] = await Promise.all([
        readPages<CollectionRow>((from, to) => client.from("collections").select(collectionColumns).order("created_at").order("id").range(from, to)),
        readPages<NoteRow>((from, to) => client.from("notes").select("id,collection_id,title,created_at,cover_path,deleted_at").order("id").range(from, to)),
      ]);
      const activeNotes = notes.filter((note) => !note.deleted_at);
      for (const note of notes) {
        if (note.deleted_at) void finishDelete(note.id).catch(() => {});
      }
      return { collections: collections.map(fromCollectionRow), notes: activeNotes.map(fromNoteRow) };
    },
    async createCollection(collection) {
      const row = { id: collection.id, title: collection.title, buddhist_year: collection.year, owner_id: owner };
      if (collection.year === undefined) return fromCollectionRow(unwrap<CollectionRow>(await client.from("collections").upsert(row).select(collectionColumns).single()));
      const result = await client.from("collections")
        .upsert(row, { onConflict: "owner_id,buddhist_year", ignoreDuplicates: true }).select(collectionColumns).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (result.data) return fromCollectionRow(result.data);
      const existing = fromCollectionRow(unwrap<CollectionRow>(await client.from("collections").select(collectionColumns).eq("buddhist_year", collection.year).single()));
      if (existing.trashedAt) throw new Error(YEAR_TABLE_IN_TRASH);
      return existing;
    },
    async setCollectionTrashed(id, trashed) {
      return fromCollectionRow(unwrap<CollectionRow>(await client.from("collections")
        .update({ trashed_at: trashed ? new Date().toISOString() : null }).eq("id", id).select(collectionColumns).single()));
    },
    async createNote(note) {
      if ([note.image, note.thumbnail].some((image) => image && image.size > MAX_UPLOAD_BYTES)) {
        throw new Error("Each uploaded image must be 400 KB or smaller.");
      }
      const wounds = note.wounds ?? [];
      if (wounds.length) validateWoundPhotos(wounds);
      const folder = noteFolder(note.id);
      const imagePath = note.image ? `${folder}/scan.jpg` : null;
      const coverPath = note.thumbnail ? `${folder}/cover.jpg` : null;
      if (imagePath && note.image) unwrap(await images.upload(imagePath, note.image, { upsert: true, contentType: "image/jpeg" }));
      if (coverPath && note.thumbnail) unwrap(await images.upload(coverPath, note.thumbnail, { upsert: true, contentType: "image/jpeg" }));
      try {
        const woundPaths = await uploadWoundPhotos(note.id, wounds);
        const fields = {
          p_id: note.id,
          p_collection_id: note.collectionId,
          p_title: note.title,
          p_cover_path: coverPath,
          p_image_path: imagePath,
          p_page_ratio: note.ratio ?? DEFAULT_PAGE_RATIO,
        };
        const request = woundPaths.length ? client.rpc("create_note_with_wounds", { ...fields, p_wounds: woundPaths }) : client.rpc("create_note", fields);
        const row = unwrap<NoteRow>(await request.single());
        return fromNoteRow(row);
      } catch (error) {
        if (error instanceof DuplicateNoteNameError && (imagePath || coverPath || wounds.length)) {
          const existing = await client.from("notes").select("id").eq("id", note.id).maybeSingle();
          if (!existing.error && !existing.data) await removeNoteImages(note.id).catch(() => {});
        }
        throw error;
      }
    },
    async renameNote(id, title) {
      unwrap(await client.from("notes").update({ title }).eq("id", id).is("deleted_at", null).select("id").single());
    },
    async deleteNote(id) {
      const marked = unwrap<Pick<NoteRow, "id">[]>(await client.from("notes")
        .update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id"));
      // Keep the marked row so a later library load can retry interrupted Storage cleanup.
      if (marked[0]) await finishDelete(marked[0].id).catch(() => {});
    },
    async appendWoundPhotos(id, photos) {
      validateWoundPhotos(photos);
      const paths = await uploadWoundPhotos(id, photos);
      const { error } = await client.rpc("append_wound_pages", { p_note_id: id, p_images: paths });
      if (error) {
        if (error.message === "This document is unavailable.") await images.remove(paths).catch(() => {});
        throw new Error(error.message);
      }
    },
    async openNote(id) {
      const pages = await readPages<PageRow>((from, to) => client.from("note_pages")
        .select("page_number,kind,image_path,page_ratio,strokes").eq("note_id", id).order("page_number").range(from, to));
      if (!pages.length) throw new Error("This note could not be found.");
      return pages.map((page) => ({ number: page.page_number, kind: page.kind, background: page.image_path, ratio: page.page_ratio, strokes: page.strokes }));
    },
    async saveInk(id, pageNumber, strokes) {
      unwrap(await client.from("note_pages").update({ strokes }).eq("note_id", id).eq("page_number", pageNumber).select("note_id").single());
    },
    async imageUrl(path) {
      return unwrap(await images.createSignedUrl(path, 3600)).signedUrl;
    },
  };
}

type LegacyPage = Omit<NotePage, "number" | "kind">;
type DemoPage = NotePage & { photoId?: string };
type DemoLibrary = Library & { pages: Record<string, LegacyPage | DemoPage[]> };
const demoKey = "gods-note-demo-v1";

function firstPage(background: LegacyPage["background"], ratio = DEFAULT_PAGE_RATIO): DemoPage {
  return { number: 1, kind: "document", background, ratio, strokes: [] };
}

function demoPages(library: DemoLibrary, id: string): DemoPage[] {
  const value = library.pages[id];
  if (!value) throw new Error("This note could not be found.");
  return Array.isArray(value) ? value : [{ ...value, number: 1, kind: "document" }];
}

function addDemoWounds(library: DemoLibrary, id: string, photos: WoundPhoto[]) {
  const pages = demoPages(library, id);
  const existing = new Set(pages.map((page) => page.photoId));
  for (const photo of photos) {
    if (existing.has(photo.id)) continue;
    pages.push({ number: (pages.at(-1)?.number ?? 0) + 1, kind: "wound", photoId: photo.id, background: photo.image, ratio: A4_WIDTH / A4_HEIGHT, strokes: [] });
    existing.add(photo.id);
  }
  library.pages[id] = pages;
}

function createDemoLibrary(): DemoLibrary {
  const titles = ["Biology", "Chemistry", "Physics", "Algebra", "Anatomy", "Lecture 01", "Lecture 02", "Lecture 03", "Reading list", "Practice", "Lab notes", "Diagrams", "Summary", "References", "Review"];
  const notes = titles.map((title, sample) => ({
    id: `sample-${sample}`, collectionId: "study", title, sample, cover: null,
    createdAt: new Date(Date.UTC(2026, 9, sample + 1)).toISOString(),
  }));
  const pages = Object.fromEntries(notes.map(({ id }) => [id, [firstPage(null)]]));
  return { collections: [{ id: "study", title: "Study notes" }, { id: "personal", title: "Personal notes" }], notes, pages };
}

export const demoRepository: NoteRepository = {
  async list() {
    const { collections, notes } = await get<DemoLibrary>(demoKey) ?? createDemoLibrary();
    return { collections, notes };
  },
  async createCollection(collection) {
    let result = collection;
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      const existing = library.collections.find((group) => group.year !== undefined && group.year === collection.year);
      if (existing?.trashedAt) throw new Error(YEAR_TABLE_IN_TRASH);
      if (existing) { result = existing; return library; }
      library.collections = [...library.collections.filter(({ id }) => id !== collection.id), collection];
      return library;
    });
    return result;
  },
  async setCollectionTrashed(id, trashed) {
    let table: Collection | undefined;
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      table = library.collections.find((group) => group.id === id);
      if (!table) throw new Error("This table could not be found.");
      table.trashedAt = trashed ? new Date().toISOString() : undefined;
      return library;
    });
    if (!table) throw new Error("This table could not be found.");
    return table;
  },
  async createNote(input) {
    const wounds = input.wounds ?? [];
    if (wounds.length) validateWoundPhotos(wounds);
    const note: Note = { id: input.id, collectionId: input.collectionId, title: input.title, cover: input.thumbnail ?? null, createdAt: new Date().toISOString() };
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      assertNoteNameAvailable(library.notes, note.title, note.id);
      const existing = library.notes.find(({ id }) => id === note.id);
      if (existing) {
        note.createdAt = existing.createdAt;
        Object.assign(existing, note);
      } else {
        library.notes.push(note);
        library.pages[note.id] = [firstPage(input.image ?? null, input.ratio)];
      }
      if (wounds.length) addDemoWounds(library, note.id, wounds);
      return library;
    });
    return note;
  },
  async renameNote(id, title) {
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      const note = library.notes.find((entry) => entry.id === id);
      if (!note) throw new Error("This note could not be found.");
      assertNoteNameAvailable(library.notes, title, id);
      note.title = title;
      return library;
    });
  },
  async deleteNote(id) {
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      library.notes = library.notes.filter((note) => note.id !== id);
      delete library.pages[id];
      return library;
    });
  },
  async appendWoundPhotos(id, photos) {
    validateWoundPhotos(photos);
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      addDemoWounds(library, id, photos);
      return library;
    });
  },
  async openNote(id) {
    const library = await get<DemoLibrary>(demoKey) ?? createDemoLibrary();
    return demoPages(library, id);
  },
  async saveInk(id, pageNumber, strokes) {
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      const pages = demoPages(library, id);
      const page = pages.find((item) => item.number === pageNumber);
      if (!page) throw new Error("This page could not be found.");
      page.strokes = strokes;
      library.pages[id] = pages;
      return library;
    });
  },
  async imageUrl(path) {
    return path;
  },
};
