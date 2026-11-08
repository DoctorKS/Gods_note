"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, Check, Eraser, Highlighter, LoaderCircle, PenLine, Save, Undo2 } from "lucide-react";
import type { InkPoint, Note, NotePage, NoteRepository, Stroke } from "../lib/models";
import { MediaImage, PreviewSheet } from "./ui";

const colors = [
  { name: "Blue", value: "#234fe5" },
  { name: "Black", value: "#17223b" },
  { name: "Red", value: "#d2404f" },
  { name: "Green", value: "#16845f" },
  { name: "Yellow", value: "#efb700" },
];

export function NoteEditor({ note, repository, onBack }: { note: Note; repository: NoteRepository; onBack: () => void }) {
  const [page, setPage] = useState<NotePage>();
  const [error, setError] = useState("");
  const [load, setLoad] = useState(0);
  useEffect(() => {
    let active = true;
    repository.openNote(note.id).then((data) => {
      if (active) setPage(data);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not open this note.");
    });
    return () => { active = false; };
  }, [load, note.id, repository]);

  if (page) return <WritingSurface note={note} page={page} repository={repository} onBack={onBack} />;
  return <main className="editor">
    <header className="editor-header"><button className="button text-button" onClick={onBack}><ArrowLeft size={19} /> Library</button><h1>{note.title}</h1></header>
    <div className="empty-state editor-state">{error ? <><p role="alert">{error}</p><button className="button secondary" onClick={() => { setError(""); setLoad((value) => value + 1); }}>Try again</button></> : <p role="status">Opening note…</p>}</div>
  </main>;
}

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  const { points, tool } = stroke;
  if (!points.length) return;
  const size = Math.min(width, height);
  const coordinates = (point: InkPoint): [number, number] => [point.x * width, point.y * height];
  const thickness = (pressure: number) => size * (0.0022 + pressure * 0.004);
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (tool === "eraser") context.globalCompositeOperation = "destination-out";
  if (tool === "highlighter") context.globalAlpha = 0.32;

  if (tool === "pen" && points.length > 1) {
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      context.beginPath();
      context.lineWidth = thickness((previous.pressure + current.pressure) / 2);
      context.moveTo(...coordinates(previous));
      context.lineTo(...coordinates(current));
      context.stroke();
    }
  } else {
    context.lineWidth = tool === "eraser" ? size * 0.028 : tool === "highlighter" ? size * 0.023 : thickness(points[0].pressure);
    context.beginPath();
    if (points.length === 1) {
      const [x, y] = coordinates(points[0]);
      context.arc(x, y, context.lineWidth / 2, 0, 2 * Math.PI);
      context.fill();
    } else {
      context.moveTo(...coordinates(points[0]));
      for (const point of points.slice(1)) context.lineTo(...coordinates(point));
      context.stroke();
    }
  }
  context.restore();
}

function WritingSurface({ note, page, repository, onBack }: { note: Note; page: NotePage; repository: NoteRepository; onBack: () => void }) {
  const [tool, setTool] = useState<Stroke["tool"]>("pen");
  const [color, setColor] = useState(colors[0].value);
  const [pencilOnly, setPencilOnly] = useState(true);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [count, setCount] = useState(page.strokes.length);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(page.strokes);
  const saved = useRef(page.strokes);
  const draft = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  const frame = useRef(0);
  const timer = useRef(0);
  const saveQueue = useRef(Promise.resolve(true));

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
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
        await repository.saveInk(note.id, snapshot);
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
    if (leaving || draft.current || event.button !== 0 || (pencilOnly && event.pointerType === "touch")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draft.current = { pointerId: event.pointerId, stroke: { tool, color, points: [point(event.nativeEvent, event.currentTarget.getBoundingClientRect())] } };
    schedulePaint();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (draft.current?.pointerId !== event.pointerId) return;
    const samples = event.nativeEvent.getCoalescedEvents?.();
    const rect = event.currentTarget.getBoundingClientRect();
    for (const sample of samples?.length ? samples : [event.nativeEvent]) draft.current.stroke.points.push(point(sample, rect));
    schedulePaint();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
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

  async function goBack() {
    if (draft.current || leaving) return;
    setLeaving(true);
    if (await flush()) onBack();
    else setLeaving(false);
  }

  const tools = [{ name: "pen", icon: PenLine }, { name: "highlighter", icon: Highlighter }, { name: "eraser", icon: Eraser }] as const;
  return <main className="editor">
    <header className="editor-header">
      <button className="button text-button" onClick={() => void goBack()} disabled={leaving}><ArrowLeft size={19} /> Library</button>
      <h1>{note.title}</h1>
      <div className="editor-save">
        <span role="status" className={status === "error" ? "form-error" : "muted"}>
          {status === "saved" ? <><Check size={16} /> Saved</> : status === "saving" ? <><LoaderCircle size={16} className="spinner" /> Saving…</> : status === "error" ? "Save failed" : "Unsaved changes"}
        </span>
        <button className="icon-button" type="button" aria-label="Save note" disabled={status === "saved" || status === "saving"} onClick={() => void flush()}><Save size={18} /></button>
      </div>
    </header>
    <div className="editor-toolbar" aria-label="Writing tools">
      <div className="tool-group">
        {tools.map(({ name, icon: Icon }) => <button type="button" key={name} aria-label={name} aria-pressed={name === tool} title={name} className={name === tool ? "icon-button active-tool" : "icon-button"} onClick={() => setTool(name)}><Icon size={21} /></button>)}
        <button type="button" className="icon-button" aria-label="Undo stroke" title="Undo" disabled={!count} onClick={() => changeInk(strokes.current.slice(0, -1))}><Undo2 size={20} /></button>
      </div>
      <div className="tool-group swatches">
        {colors.map(({ name, value }) => <button key={value} type="button" className={value === color ? "swatch active-swatch" : "swatch"}
          aria-label={name} aria-pressed={value === color} style={{ background: value }} onClick={() => setColor(value)} />)}
      </div>
      <label className="pencil-setting"><input type="checkbox" checked={pencilOnly} onChange={(event) => setPencilOnly(event.target.checked)} /> Pencil only</label>
    </div>
    {(error || imageError) && <p className="editor-error form-error" role="alert">{error || "The page image could not load. Return to the library and reopen the note to try again."}</p>}
    <div className="paper-stage">
      <div className="writing-paper" style={{ aspectRatio: page.ratio, width: `min(100%, ${Math.min(900, 880 * page.ratio)}px)` }}>
        {page.background ? <MediaImage source={page.background} repository={repository} className="paper-background" onError={() => setImageError(true)} /> :
          note.sample !== undefined ? <div className="paper-background"><PreviewSheet title={note.title} sample={note.sample} /></div> :
            <div className="ruled-paper" />}
        <canvas ref={canvasRef} aria-label="Drawing area" onPointerDown={start} onPointerMove={move}
          onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
      </div>
    </div>
  </main>;
}
