export const MAX_BATCH_IMAGES = 10;
export const MAX_UPLOAD_BYTES = 400_000;
export const DEFAULT_PAGE_RATIO = 0.75;

export type Collection = { id: string; title: string };

export type Note = {
  id: string;
  collectionId: string;
  title: string;
  createdAt: string;
  cover: string | Blob | null;
  sample?: number;
};

export class DuplicateNoteNameError extends Error {
  constructor() { super("A document with this name already exists."); }
}

export function noteNameKey(title: string) {
  return title.trim().toLowerCase();
}

export function assertNoteNameAvailable(notes: Note[], title: string, exceptId: string) {
  const key = noteNameKey(title);
  if (notes.some((note) => note.id !== exceptId && noteNameKey(note.title) === key)) {
    throw new DuplicateNoteNameError();
  }
}

export type InkPoint = { x: number; y: number; pressure: number };
export type Stroke = { points: InkPoint[]; color: string; tool: "pen" | "highlighter" | "eraser" };

export type NotePage = {
  background: string | Blob | null;
  ratio: number;
  strokes: Stroke[];
};

export type NewNote = Pick<Note, "id" | "collectionId" | "title"> & {
  image?: Blob;
  thumbnail?: Blob;
  ratio?: number;
};

export type Library = { collections: Collection[]; notes: Note[] };

export interface NoteRepository {
  list(): Promise<Library>;
  createCollection(collection: Collection): Promise<Collection>;
  createNote(note: NewNote): Promise<Note>;
  renameNote(id: string, title: string): Promise<void>;
  deleteNote(id: string): Promise<void>;
  openNote(id: string): Promise<NotePage>;
  saveInk(id: string, strokes: Stroke[]): Promise<void>;
  imageUrl(path: string): Promise<string>;
}
