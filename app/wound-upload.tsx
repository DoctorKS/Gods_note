"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { MAX_BATCH_IMAGES, type Library, type Note, type NoteRepository, type WoundPhoto } from "../lib/models";
import { prepareWoundPhoto } from "../lib/scanner";
import { Dialog, MediaImage } from "./ui";

export function WoundPicker({ photos, maxPhotos, repository, disabled, onChange, onBusyChange }: {
  photos: WoundPhoto[];
  maxPhotos: number;
  repository: NoteRepository;
  disabled: boolean;
  onChange: (photos: WoundPhoto[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  async function prepare(files: File[]) {
    if (!files.length || disabled) return;
    if (files.length + photos.length > maxPhotos) {
      setError("Choose no more than 10 images per batch, including document scans.");
      return;
    }
    setError("");
    onBusyChange(true);
    try {
      const next = [...photos];
      const failed: string[] = [];
      for (const file of files) {
        try { next.push(await prepareWoundPhoto(file)); }
        catch { failed.push(file.name); }
      }
      if (failed.length) setError(`Could not prepare: ${failed.join(", ")}. Try a JPEG or PNG.`);
      onChange(next);
    } finally {
      onBusyChange(false);
    }
  }

  return <div className="wound-picker">
    <div className="wound-picker-heading">
      <div><h3>Wound photos</h3><p>Each photo is an A4 page of up to 200 KB.</p></div>
      <button className="button secondary" type="button" disabled={disabled || photos.length >= maxPhotos} onClick={() => input.current?.click()}><ImagePlus size={17} /> Add wound photos</button>
    </div>
    <input ref={input} type="file" accept="image/*" multiple className="visually-hidden" tabIndex={-1} aria-label="Choose wound images" onChange={(event) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void prepare(files);
    }} />
    {photos.length > 0 && <ol className="wound-list">
      {photos.map((photo) => <li key={photo.id}>
        <MediaImage source={photo.image} repository={repository} className="wound-thumb" />
        <span title={photo.name}>{photo.name}</span>
        <button type="button" className="icon-button" aria-label={`Remove ${photo.name}`} disabled={disabled}
          onClick={() => onChange(photos.filter(({ id }) => id !== photo.id))}><X size={16} /></button>
      </li>)}
    </ol>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

export function WoundUpload({ library, repository, destination, onClose, onDone }: {
  library: Library;
  repository: NoteRepository;
  destination?: string;
  onClose: () => void;
  onDone: (note: Note) => void;
}) {
  const [noteId, setNoteId] = useState(() => (library.notes.find((note) => note.collectionId === destination) ?? library.notes[0])?.id ?? "");
  const [photos, setPhotos] = useState<WoundPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const selected = library.notes.find(({ id }) => id === noteId);

  async function save() {
    if (!selected || !photos.length || preparing || saving) return;
    setError("");
    setAttempted(true);
    setSaving(true);
    try {
      await repository.appendWoundPhotos(selected.id, photos);
      onDone(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add wound photos.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog title="Upload wound photos" description="Add photos in order after the last page of a document." onClose={onClose} busy={preparing || saving}>
    <div className="form-stack">
      <label>Document<select aria-label="Document" value={noteId} disabled={preparing || attempted} onChange={(event) => setNoteId(event.target.value)}>
        {library.collections.map((group) => {
          const documents = library.notes.filter((note) => note.collectionId === group.id);
          return documents.length > 0 && <optgroup key={group.id} label={group.title}>
            {documents.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
          </optgroup>;
        })}
      </select></label>
      <WoundPicker photos={photos} maxPhotos={MAX_BATCH_IMAGES} repository={repository} disabled={preparing || attempted}
        onChange={setPhotos} onBusyChange={setPreparing} />
      {preparing && <p className="muted" role="status">Preparing wound photos…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button secondary" disabled={preparing || saving} onClick={onClose}>Close</button>
        <button className="button primary" disabled={!selected || !photos.length || preparing || saving} onClick={() => void save()}>{saving ? "Saving…" : "Add pages"}</button>
      </div>
    </div>
  </Dialog>;
}
