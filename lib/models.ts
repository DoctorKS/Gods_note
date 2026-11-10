export const MAX_BATCH_IMAGES = 10;
export const MAX_UPLOAD_BYTES = 400_000;
export const MAX_WOUND_BYTES = 200_000;
export const DEFAULT_PAGE_RATIO = 0.75;
export const A4_WIDTH = 1260;
export const A4_HEIGHT = 1782;
export const LAST_BUDDHIST_YEAR = 2600;

const bangkokYear = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", year: "numeric" });
export const buddhistYear = (date = new Date()) => Number(bangkokYear.format(date)) + 543;
export const yearTitle = (year: number) => `พ.ศ. ${year}`;

export type Collection = { id: string; title: string; year?: number; trashedAt?: string };

export const YEAR_TABLE_IN_TRASH = "This year's table is in Trash. Restore it to use it again.";

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
  number: number;
  kind: "document" | "wound";
  background: string | Blob | null;
  ratio: number;
  strokes: Stroke[];
};

export type WoundPhoto = { id: string; name: string; image: Blob };

export type NewNote = Pick<Note, "id" | "collectionId" | "title"> & {
  image?: Blob;
  thumbnail?: Blob;
  ratio?: number;
  wounds?: WoundPhoto[];
};

export type Library = { collections: Collection[]; notes: Note[] };

export interface NoteRepository {
  list(): Promise<Library>;
  createCollection(collection: Collection): Promise<Collection>;
  setCollectionTrashed(id: string, trashed: boolean): Promise<Collection>;
  createNote(note: NewNote): Promise<Note>;
  renameNote(id: string, title: string): Promise<void>;
  deleteNote(id: string): Promise<void>;
  appendWoundPhotos(id: string, photos: WoundPhoto[]): Promise<void>;
  openNote(id: string): Promise<NotePage[]>;
  saveInk(id: string, pageNumber: number, strokes: Stroke[]): Promise<void>;
  imageUrl(path: string): Promise<string>;
}
