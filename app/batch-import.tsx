"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Check, CircleAlert, Crop, ImagePlus, Images, LoaderCircle, ScanLine, X } from "lucide-react";
import { MAX_BATCH_IMAGES, noteNameKey, type Collection, type Note, type NoteRepository, type WoundPhoto } from "../lib/models";
import { FULL_IMAGE, prepareImage, scanImage, type Corners, type Point, type PreparedImage, type Scan } from "../lib/scanner";
import { Dialog, MediaImage } from "./ui";
import { WoundPicker } from "./wound-upload";

type BatchItem = {
  id: string;
  title: string;
  file: File;
  wounds?: WoundPhoto[];
  prepared?: PreparedImage;
  corners?: Corners;
  result?: Scan;
  error?: string;
  saved?: boolean;
};

type BatchProps = {
  collections: Collection[];
  notes: Note[];
  destination: string;
  repository: NoteRepository;
  onClose: () => void;
  onSaved: (note: Note) => void;
  onDone: (count: number, collectionId: string) => void;
};

export function BatchImport({ collections, notes, destination, repository, onClose, onSaved, onDone }: BatchProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [collectionId, setCollectionId] = useState(destination || collections[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = items.find(({ id }) => id === currentId) ?? items[0];
  const imageCount = items.reduce((count, item) => count + 1 + (item.wounds?.length ?? 0), 0);
  const unsaved = items.filter((item) => !item.saved);
  const names = new Map<string, number>();
  for (const { title } of [...notes, ...unsaved]) {
    const key = noteNameKey(title);
    if (key) names.set(key, (names.get(key) ?? 0) + 1);
  }
  const duplicates = new Set(unsaved.filter(({ title }) => (names.get(noteNameKey(title)) ?? 0) > 1).map(({ id }) => id));
  const canSave = unsaved.length > 0 && Boolean(collectionId) && duplicates.size === 0 && unsaved.every(({ title, result }) => title.trim() && result);

  function patchItem(id: string, changes: Partial<BatchItem>) {
    setItems((list) => list.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async function scanFiles(files: File[]) {
    if (!files.length || busy || attempted) return;
    if (files.length + imageCount > MAX_BATCH_IMAGES) {
      setMessage("Choose no more than 10 images per batch.");
      return;
    }

    setMessage("");
    const batch = files.map((file) => ({
      file, id: crypto.randomUUID(),
      title: file.name.replace(/\.[^.]+$/, "").trim().slice(0, 160) || "Untitled document",
    }));
    setItems((list) => [...list, ...batch]);
    setCurrentId(batch[0].id);
    for (const [index, item] of batch.entries()) {
      setBusy(`Scanning ${index + 1} of ${batch.length}…`);
      try {
        const prepared = await prepareImage(item.file);
        const corners = prepared.corners ?? FULL_IMAGE;
        patchItem(item.id, { prepared, corners });
        if (prepared.corners) patchItem(item.id, { result: await scanImage(prepared.original, corners) });
      } catch (error) {
        patchItem(item.id, { error: error instanceof Error ? error.message : "Could not scan this image." });
      }
    }
    setBusy("");
  }

  async function applyCrop(item: BatchItem) {
    if (!item.prepared || !item.corners || busy || attempted) return;
    setBusy("Applying crop…");
    try {
      patchItem(item.id, { result: await scanImage(item.prepared.original, item.corners), error: undefined });
    } catch (error) {
      patchItem(item.id, { error: error instanceof Error ? error.message : "Could not apply this crop." });
    } finally {
      setBusy("");
    }
  }

  async function saveBatch() {
    if (!canSave || busy) return;
    setAttempted(true);
    setMessage("");
    let count = items.length - unsaved.length;
    let firstFailure = "";
    for (const [index, item] of unsaved.entries()) {
      if (!item.result) continue;
      setBusy(`Saving ${index + 1} of ${unsaved.length}…`);
      try {
        const note = await repository.createNote({ id: item.id, collectionId, title: item.title.trim(), wounds: item.wounds, ...item.result });
        patchItem(item.id, { saved: true, error: undefined });
        onSaved(note);
        count++;
      } catch (error) {
        firstFailure ||= item.id;
        patchItem(item.id, { error: error instanceof Error ? error.message : "Could not save this document." });
      }
    }
    setBusy("");
    if (firstFailure) {
      setCurrentId(firstFailure);
      setMessage(`${count} of ${items.length} documents saved. Retry the remaining images.`);
    } else {
      onDone(count, collectionId);
    }
  }

  return <Dialog title="Batch upload" description="Each scan is a separate document of up to 400 KB. Add wound photos to a scan to make extra pages in that document." onClose={onClose} wide busy={Boolean(busy)}>
    <div className="batch-content">
      <div className="batch-options">
        <label>Destination table<select aria-label="Destination table" value={collectionId} onChange={(event) => setCollectionId(event.target.value)} disabled={Boolean(busy) || attempted}>
          {collections.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
        </select></label>
        <span className="count-badge">{imageCount} / {MAX_BATCH_IMAGES} images</span>
      </div>
      <input ref={fileInput} type="file" multiple accept="image/*" className="visually-hidden" tabIndex={-1} aria-label="Choose images" onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        void scanFiles(files);
      }} />
      {items.length === 0 ? <div className={dragging ? "drop-zone dragging" : "drop-zone"}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void scanFiles(Array.from(event.dataTransfer.files)); }}>
        <span className="upload-icon"><ImagePlus size={28} /></span>
        <h3>Choose document images</h3><p>Select photos from your iPad or drop them here.</p>
        <button className="button primary" onClick={() => fileInput.current?.click()}><Images size={17} /> Choose images</button>
      </div> : <>
        <div className="batch-rail" aria-label="Images in this batch">
          {items.map((item) => <button type="button" key={item.id} className={item.id === current?.id ? "batch-tab selected" : "batch-tab"} aria-pressed={item.id === current?.id} onClick={() => setCurrentId(item.id)}>
            <span className="batch-thumb">
              {item.result ? <MediaImage source={item.result.thumbnail} repository={repository} className="batch-thumb-image" /> : <ScanLine size={17} />}
            </span>
            <span>{item.title || "Untitled"}</span>
            {item.saved && <Check size={15} className="success-text" aria-label="Saved" />}
            {duplicates.has(item.id) && <CircleAlert size={15} className="danger-text" aria-label="Duplicate name" />}
          </button>)}
          {!attempted && imageCount < MAX_BATCH_IMAGES && <button className="button secondary batch-add" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><ImagePlus size={17} /> Add images</button>}
        </div>
        {current && <div className="batch-review" key={current.id}>
          <div className="scan-comparison">
            <div className="scan-panel"><h3>Original</h3><div className="scan-stage">
              {current.prepared && current.corners ? <CropPreview source={current.prepared} corners={current.corners} repository={repository}
                disabled={Boolean(busy) || attempted}
                onChange={(corners) => patchItem(current.id, { corners, result: undefined, error: undefined })} /> :
                <p>{current.error ? "Original unavailable" : "Preparing image…"}</p>}
            </div></div>
            <div className="scan-panel"><h3>Scan preview</h3><div className="scan-stage">
              {current.result ? <MediaImage source={current.result.image} repository={repository} className="scan-result" /> :
                <div className="scan-placeholder"><Crop size={23} /><p>{current.prepared ? "Position the corners and apply the crop." : "Preview appears after scanning."}</p></div>}
            </div></div>
          </div>
          {!current.prepared?.corners && current.prepared && !current.result && !current.error && <p className="muted">Automatic detection could not find a clear edge. Drag the four handles around the paper.</p>}
          {current.error && <p className="form-error" role="alert">{current.error}</p>}
          <div className="review-controls">
            <label>Document name<input value={current.title} maxLength={160} disabled={Boolean(busy) || current.saved}
              aria-invalid={duplicates.has(current.id)} onChange={(event) => patchItem(current.id, { title: event.target.value })} /></label>
            {current.prepared && !attempted && <button className="button secondary" disabled={Boolean(busy) || Boolean(current.result)} onClick={() => void applyCrop(current)}><Crop size={17} /> Apply crop</button>}
            {!attempted && <button className="icon-button" aria-label="Remove selected image" disabled={Boolean(busy)} onClick={() => {
              setItems((list) => list.filter(({ id }) => id !== current.id));
              setMessage("");
            }}><X size={19} /></button>}
          </div>
          {current.prepared && <WoundPicker photos={current.wounds ?? []} maxPhotos={MAX_BATCH_IMAGES - imageCount + (current.wounds?.length ?? 0)}
            repository={repository} disabled={Boolean(busy) || attempted}
            onChange={(wounds) => { patchItem(current.id, { wounds }); setMessage(""); }}
            onBusyChange={(preparing) => setBusy(preparing ? "Preparing wound photos…" : "")} />}
        </div>}
      </>}
      {duplicates.size > 0 && <p className="form-error" role="alert">Document names must be unique. Rename the marked images before saving.</p>}
      {message && <p className="form-error" role="alert">{message}</p>}
      <div className="dialog-actions">
        {busy && <span className="busy-label" role="status"><LoaderCircle size={16} className="spinner" />{busy}</span>}
        <button className="button secondary" disabled={Boolean(busy)} onClick={onClose}>{attempted ? "Close" : "Cancel"}</button>
        <button className="button primary" disabled={Boolean(busy) || !canSave} onClick={() => void saveBatch()}>
          {attempted ? "Retry remaining" : unsaved.length === 1 ? "Save document" : unsaved.length ? `Save ${unsaved.length} documents` : "Save documents"}
        </button>
      </div>
    </div>
  </Dialog>;
}

function CropPreview({ source, corners, repository, disabled, onChange }: {
  source: PreparedImage;
  corners: Corners;
  repository: NoteRepository;
  disabled: boolean;
  onChange: (corners: Corners) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  function replaceCorner(index: number, point: Point) {
    const next: Corners = [...corners];
    next[index] = { x: clamp(point.x), y: clamp(point.y) };
    onChange(next);
  }

  function move(event: PointerEvent<HTMLButtonElement>, index: number) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    replaceCorner(index, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  }

  function keyMove(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const deltas: Record<string, Point> = {
      ArrowLeft: { x: -0.015, y: 0 }, ArrowRight: { x: 0.015, y: 0 },
      ArrowUp: { x: 0, y: -0.015 }, ArrowDown: { x: 0, y: 0.015 },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    replaceCorner(index, { x: corners[index].x + delta.x, y: corners[index].y + delta.y });
  }

  const names = ["top left", "top right", "bottom right", "bottom left"];
  return <div className="crop-frame" ref={frame} style={{ aspectRatio: source.ratio, "--photo-ratio": source.ratio } as CSSProperties}>
    <MediaImage source={source.original} repository={repository} className="crop-photo" />
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="crop-outline">
      <polygon points={corners.map(({ x, y }) => `${x * 100},${y * 100}`).join(" ")} vectorEffect="non-scaling-stroke" />
    </svg>
    {corners.map(({ x, y }, index) => <button key={index} type="button" className="crop-handle" aria-label={`Move ${names[index]} corner`} disabled={disabled}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={(event) => move(event, index)} onKeyDown={(event) => keyMove(event, index)} />)}
  </div>;
}
