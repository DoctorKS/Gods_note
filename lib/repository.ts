import { createClient } from "@supabase/supabase-js";
import { get, update } from "idb-keyval";
import { assertNoteNameAvailable, DEFAULT_PAGE_RATIO, DuplicateNoteNameError, MAX_UPLOAD_BYTES, type Library, type Note, type NotePage, type NoteRepository } from "./models";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = projectUrl && publishableKey ? createClient(projectUrl, publishableKey) : null;

type NoteRow = { id: string; collection_id: string; title: string; created_at: string; cover_path: string | null; deleted_at: string | null };
type PageRow = { image_path: string | null; page_ratio: number; strokes: NotePage["strokes"] };
type ApiError = { message: string; code?: string };

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
    unwrap(await images.remove([`${folder}/scan.jpg`, `${folder}/cover.jpg`]));
  }

  const finishDelete = async (note: Pick<NoteRow, "id" | "cover_path">) => {
    if (note.cover_path) await removeNoteImages(note.id);
    const { error } = await client.from("notes").delete().eq("id", note.id).not("deleted_at", "is", null);
    if (error) throw new Error(error.message);
  };

  return {
    async list() {
      const [collections, notes] = await Promise.all([
        readPages((from, to) => client.from("collections").select("id,title").order("created_at").order("id").range(from, to)),
        readPages<NoteRow>((from, to) => client.from("notes").select("id,collection_id,title,created_at,cover_path,deleted_at").order("id").range(from, to)),
      ]);
      const activeNotes = notes.filter((note) => !note.deleted_at);
      for (const note of notes) {
        if (note.deleted_at) void finishDelete(note).catch(() => {});
      }
      return { collections, notes: activeNotes.map(fromNoteRow) };
    },
    async createCollection(collection) {
      return unwrap(await client.from("collections").upsert(collection).select("id,title").single());
    },
    async createNote(note) {
      if ([note.image, note.thumbnail].some((image) => image && image.size > MAX_UPLOAD_BYTES)) {
        throw new Error("Each uploaded image must be 400 KB or smaller.");
      }
      const folder = noteFolder(note.id);
      const imagePath = note.image ? `${folder}/scan.jpg` : null;
      const coverPath = note.thumbnail ? `${folder}/cover.jpg` : null;
      if (imagePath && note.image) unwrap(await images.upload(imagePath, note.image, { upsert: true, contentType: "image/jpeg" }));
      if (coverPath && note.thumbnail) unwrap(await images.upload(coverPath, note.thumbnail, { upsert: true, contentType: "image/jpeg" }));
      try {
        const row = unwrap<NoteRow>(await client.rpc("create_note", {
          p_id: note.id,
          p_collection_id: note.collectionId,
          p_title: note.title,
          p_cover_path: coverPath,
          p_image_path: imagePath,
          p_page_ratio: note.ratio ?? DEFAULT_PAGE_RATIO,
        }).single());
        return fromNoteRow(row);
      } catch (error) {
        if (error instanceof DuplicateNoteNameError && (imagePath || coverPath)) {
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
      const marked = unwrap<Pick<NoteRow, "id" | "cover_path">[]>(await client.from("notes")
        .update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id,cover_path"));
      // Keep the marked row so a later library load can retry interrupted Storage cleanup.
      if (marked[0]) await finishDelete(marked[0]).catch(() => {});
    },
    async openNote(id) {
      const page = unwrap<PageRow>(await client.from("note_pages").select("image_path,page_ratio,strokes").eq("note_id", id).eq("page_number", 1).single());
      return { background: page.image_path, ratio: page.page_ratio, strokes: page.strokes };
    },
    async saveInk(id, strokes) {
      unwrap(await client.from("note_pages").update({ strokes }).eq("note_id", id).eq("page_number", 1).select("note_id").single());
    },
    async imageUrl(path) {
      return unwrap(await images.createSignedUrl(path, 3600)).signedUrl;
    },
  };
}

type DemoLibrary = Library & { pages: Record<string, NotePage> };
const demoKey = "gods-note-demo-v1";

function createDemoLibrary(): DemoLibrary {
  const titles = ["Biology", "Chemistry", "Physics", "Algebra", "Anatomy", "Lecture 01", "Lecture 02", "Lecture 03", "Reading list", "Practice", "Lab notes", "Diagrams", "Summary", "References", "Review"];
  const notes = titles.map((title, sample) => ({
    id: `sample-${sample}`, collectionId: "study", title, sample, cover: null,
    createdAt: new Date(Date.UTC(2026, 9, sample + 1)).toISOString(),
  }));
  const pages = Object.fromEntries(notes.map(({ id }) => [id, { background: null, ratio: DEFAULT_PAGE_RATIO, strokes: [] }]));
  return { collections: [{ id: "study", title: "Study notes" }, { id: "personal", title: "Personal notes" }], notes, pages };
}

export const demoRepository: NoteRepository = {
  async list() {
    const { collections, notes } = await get<DemoLibrary>(demoKey) ?? createDemoLibrary();
    return { collections, notes };
  },
  async createCollection(collection) {
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      library.collections = [...library.collections.filter(({ id }) => id !== collection.id), collection];
      return library;
    });
    return collection;
  },
  async createNote(input) {
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
        library.pages[note.id] = { background: input.image ?? null, ratio: input.ratio ?? DEFAULT_PAGE_RATIO, strokes: [] };
      }
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
  async openNote(id) {
    const library = await get<DemoLibrary>(demoKey) ?? createDemoLibrary();
    const page = library.pages[id];
    if (!page) throw new Error("This note could not be found.");
    return page;
  },
  async saveInk(id, strokes) {
    await update<DemoLibrary>(demoKey, (stored) => {
      const library = stored ?? createDemoLibrary();
      if (!library.pages[id]) throw new Error("This note could not be found.");
      library.pages[id].strokes = strokes;
      return library;
    });
  },
  async imageUrl(path) {
    return path;
  },
};
