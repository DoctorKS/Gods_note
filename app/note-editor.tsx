"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Eraser, Highlighter, LoaderCircle, Minus, Pencil, PenLine, Plus, Save, Undo2 } from "lucide-react";
import type { InkPoint, Note, NotePage, NoteRepository, Stroke } from "../lib/models";
import { drawStroke } from "../lib/ink";
import { MediaImage, PreviewSheet } from "./ui";
import { usePaperViewport } from "./use-paper-viewport";

const colors = [
  { name: "Blue", value: "#234fe5" },
  { name: "Black", value: "#17223b" },
  { name: "Red", value: "#d2404f" },
  { name: "Green", value: "#16845f" },
  { name: "Yellow", value: "#efb700" },
];

type EditorProps = { note: Note; repository: NoteRepository; onBack: () => void; onRename: () => void };
type Preferences = { tool: Stroke["tool"]; color: string; pencilOnly: boolean };

function EditorTitle({ title, onRename, disabled }: { title: string; onRename: () => void; disabled?: boolean }) {
  return <h1><button type="button" className="editor-title-button" title="Rename document" aria-label={`Rename ${title}`} onClick={onRename} disabled={disabled}>
    <span>{title}</span><Pencil size={15} />
  </button></h1>;
}

export function NoteEditor({ note, repository, onBack, onRename }: EditorProps) {
  const [pages, setPages] = useState<NotePage[]>();
  const [pageIndex, setPageIndex] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>({ tool: "pen", color: colors[0].value, pencilOnly: true });
  const [error, setError] = useState("");
  const [load, setLoad] = useState(0);
  useEffect(() => {
    let active = true;
    repository.openNote(note.id).then((data) => {
      if (active) setPages(data);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not open this note.");
    });
    return () => { active = false; };
  }, [load, note.id, repository]);

  const page = pages?.[pageIndex];
  if (page && pages) return <WritingSurface key={page.number} note={note} page={page} pageCount={pages.length} pageIndex={pageIndex}
    repository={repository} onBack={onBack} onRename={onRename} preferences={preferences} onPreferences={setPreferences}
    onNavigate={(index, strokes) => {
      setPages((current) => current?.map((item) => item.number === page.number ? { ...item, strokes } : item));
      setPageIndex(index);
      window.scrollTo(0, 0);
    }} />;
  return <main className="editor">
    <header className="editor-header"><button className="button text-button" onClick={onBack}><ArrowLeft size={19} /> Library</button><EditorTitle title={note.title} onRename={onRename} /></header>
    <div className="empty-state editor-state">{error ? <><p role="alert">{error}</p><button className="button secondary" onClick={() => { setError(""); setLoad((value) => value + 1); }}>Try again</button></> : <p role="status">Opening note…</p>}</div>
  </main>;
}

function WritingSurface({ note, page, pageCount, pageIndex, repository, onBack, onRename, preferences, onPreferences, onNavigate }: EditorProps & {
  page: NotePage;
  pageCount: number;
  pageIndex: number;
  preferences: Preferences;
  onPreferences: (preferences: Preferences) => void;
  onNavigate: (pageIndex: number, strokes: Stroke[]) => void;
}) {
  const { tool, color, pencilOnly } = preferences;
  const viewport = usePaperViewport();
  const pageWidth = Math.min(900, 880 * page.ratio) * viewport.zoom;
  const [status, setStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [count, setCount] = useState(page.strokes.length);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(page.strokes);
  const saved = useRef(page.strokes);
  const draft = useRef<{ pointerId: number; pointerType: string; stroke: Stroke } | null>(null);
  const frame = useRef(0);
  const timer = useRef(0);
  const saveQueue = useRef(Promise.resolve(true));

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Limit backing pixels when zooming so the writing layer fits mobile canvas budgets.
    const scale = Math.min(2, window.devicePixelRatio || 1, 4096 / Math.max(rect.width, rect.height),
      Math.sqrt(4_000_000 / (rect.width * rect.height)));
    const width = Math.max(1, Math.floor(rect.width * scale));
    const height = Math.max(1, Math.floor(rect.height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    for (const stroke of strokes.current) drawStroke(context, stroke, width, height);
    if (draft.current) drawStroke(context, draft.current.stroke, width, height);
  }, []);

  function schedulePaint() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; paint(); });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    const guard = (event: BeforeUnloadEvent) => {
      if (strokes.current !== saved.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      observer.disconnect();
      window.removeEventListener("beforeunload", guard);
      cancelAnimationFrame(frame.current);
      window.clearTimeout(timer.current);
    };
  }, [paint]);

  function flush() {
    window.clearTimeout(timer.current);
    const next = saveQueue.current.then(async () => {
      const snapshot = strokes.current;
      if (saved.current === snapshot) return true;
      setStatus("saving");
      setError("");
      try {
        await repository.saveInk(note.id, page.number, snapshot);
        saved.current = snapshot;
        setStatus(strokes.current === snapshot ? "saved" : "dirty");
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save the note.");
        setStatus("error");
        return false;
      }
    });
    saveQueue.current = next;
    return next;
  }

  function changeInk(next: Stroke[]) {
    strokes.current = next;
    setCount(next.length);
    setStatus("dirty");
    setError("");
    schedulePaint();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 650);
  }

  function point(event: globalThis.PointerEvent, rect: DOMRect): InkPoint {
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height), pressure: event.pressure || 0.5 };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (leaving || event.button !== 0) return;
    const isTouch = event.pointerType === "touch";
    if (draft.current && (!isTouch || draft.current.pointerType !== "touch")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (isTouch && viewport.beginTouch(event, pencilOnly)) {
      if (draft.current) { draft.current = null; schedulePaint(); }
      return;
    }
    if (!isTouch) viewport.clearTouches();
    draft.current = { pointerId: event.pointerId, pointerType: event.pointerType, stroke: { tool, color, points: [point(event.nativeEvent, event.currentTarget.getBoundingClientRect())] } };
    schedulePaint();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "touch" && viewport.moveTouch(event)) return;
    if (draft.current?.pointerId !== event.pointerId) return;
    const samples = event.nativeEvent.getCoalescedEvents?.();
    const rect = event.currentTarget.getBoundingClientRect();
    for (const sample of samples?.length ? samples : [event.nativeEvent]) draft.current.stroke.points.push(point(sample, rect));
    schedulePaint();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (viewport.endTouch(event)) return;
    if (draft.current?.pointerId !== event.pointerId) return;
    const { stroke } = draft.current;
    draft.current = null;
    if (event.type === "pointerup") {
      const last = point(event.nativeEvent, event.currentTarget.getBoundingClientRect());
      const previous = stroke.points.at(-1);
      if (previous && Math.hypot(last.x - previous.x, last.y - previous.y) > 0.001) {
        stroke.points.push({ ...last, pressure: previous.pressure });
      }
    }
    changeInk([...strokes.current, stroke]);
  }

  async function leave(action: () => void) {
    if (draft.current || leaving) return;
    setLeaving(true);
    if (await flush()) action();
    else setLeaving(false);
  }

  const tools = [{ name: "pen", icon: PenLine }, { name: "highlighter", icon: Highlighter }, { name: "eraser", icon: Eraser }] as const;
  return <main className="editor editor-document">
    <header className="editor-header">
      <button className="button text-button" onClick={() => void leave(onBack)} disabled={leaving}><ArrowLeft size={19} /> Library</button>
      <EditorTitle title={note.title} onRename={onRename} disabled={leaving} />
      <div className="editor-save">
        <span role="status" className={status === "error" ? "form-error" : "muted"}>
          {status === "saved" ? <><Check size={16} /> Saved</> : status === "saving" ? <><LoaderCircle size={16} className="spinner" /> Saving…</> : status === "error" ? "Save failed" : "Unsaved changes"}
        </span>
        <button className="icon-button" type="button" aria-label="Save note" disabled={status === "saved" || status === "saving"} onClick={() => void flush()}><Save size={18} /></button>
      </div>
    </header>
    <div className="editor-toolbar" aria-label="Writing tools">
      <div className="tool-group">
        {tools.map(({ name, icon: Icon }) => <button type="button" key={name} aria-label={name} aria-pressed={name === tool} title={name} className={name === tool ? "icon-button active-tool" : "icon-button"} onClick={() => onPreferences({ ...preferences, tool: name })}><Icon size={21} /></button>)}
        <button type="button" className="icon-button" aria-label="Undo stroke" title="Undo" disabled={!count} onClick={() => changeInk(strokes.current.slice(0, -1))}><Undo2 size={20} /></button>
      </div>
      <div className="tool-group swatches">
        {colors.map(({ name, value }) => <button key={value} type="button" className={value === color ? "swatch active-swatch" : "swatch"}
          aria-label={name} aria-pressed={value === color} style={{ background: value }} onClick={() => onPreferences({ ...preferences, color: value })} />)}
      </div>
      <label className="pencil-setting"><input type="checkbox" checked={pencilOnly} onChange={(event) => onPreferences({ ...preferences, pencilOnly: event.target.checked })} /> Pencil only</label>
    </div>
    <div className="view-controls">
      {pageCount > 1 && <nav className="page-nav" aria-label="Document pages">
        <button className="icon-button" type="button" aria-label="Previous page" disabled={leaving || pageIndex === 0}
          onClick={() => void leave(() => onNavigate(pageIndex - 1, strokes.current))}><ChevronLeft size={20} /></button>
        <span aria-live="polite">Page {pageIndex + 1} of {pageCount}{page.kind === "wound" && " · Wound photo"}</span>
        <button className="icon-button" type="button" aria-label="Next page" disabled={leaving || pageIndex === pageCount - 1}
          onClick={() => void leave(() => onNavigate(pageIndex + 1, strokes.current))}><ChevronRight size={20} /></button>
      </nav>}
      <div className="zoom-controls" role="group" aria-label="Paper zoom">
        <button className="icon-button" type="button" aria-label="Zoom out" disabled={viewport.zoom <= 1} onClick={() => viewport.zoomBy(1 / Math.SQRT2)}><Minus size={17} /></button>
        <button className="button secondary" type="button" aria-label="Fit width" title="Fit width" onClick={viewport.fit}>Fit</button>
        <button className="icon-button" type="button" aria-label="Zoom in" disabled={!viewport.canZoomIn} onClick={() => viewport.zoomBy(Math.SQRT2)}><Plus size={17} /></button>
      </div>
    </div>
    {(error || imageError) && <p className="editor-error form-error" role="alert">{error || "The page image could not load. Return to the library and reopen the note to try again."}</p>}
    <div ref={viewport.stageRef} className="paper-stage" role="region" aria-label="Paper viewport" tabIndex={0}>
      <div className="paper-track" style={{ width: `max(100%, min(${viewport.zoom * 100}%, ${pageWidth}px))` }}>
        <div ref={viewport.paperRef} className="writing-paper" style={{ aspectRatio: page.ratio, width: `min(100%, ${pageWidth}px)` }}>
          {page.background ? <MediaImage source={page.background} repository={repository} className="paper-background" onError={() => setImageError(true)} /> :
            note.sample !== undefined ? <div className="paper-background"><PreviewSheet title={note.title} sample={note.sample} /></div> :
              <div className="ruled-paper" />}
          <canvas ref={canvasRef} aria-label="Drawing area" onPointerDown={start} onPointerMove={move}
            onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
        </div>
      </div>
    </div>
  </main>;
}
