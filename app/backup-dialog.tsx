"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { exportBackup } from "../lib/backup";
import type { Library, NoteRepository } from "../lib/models";
import { Dialog, PreviewSheet } from "./ui";

export function BackupDialog({ library, repository, onClose }: { library: Library; repository: NoteRepository; onClose: () => void }) {
  const [done, setDone] = useState(0);
  const [archive, setArchive] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const samples = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setDone(0);
    setError("");
    void exportBackup(library, repository, controller.signal, setDone, (id) => {
      const sample = samples.current?.querySelector<SVGSVGElement>(`[data-sample="${CSS.escape(id)}"] svg`);
      if (!sample) return undefined;
      const copy = sample.cloneNode(true) as SVGSVGElement;
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      copy.setAttribute("width", String(sample.viewBox.baseVal.width));
      copy.setAttribute("height", String(sample.viewBox.baseVal.height));
      return new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" });
    }).then((zip) => {
      if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(zip); setArchive(objectUrl); }
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not create a backup.");
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attempt, library, repository]);

  return <Dialog title="Backup library" description="One ZIP with JPG pages and handwritten ink, organized by table and document." onClose={onClose}>
    <div hidden ref={samples}>
      {library.notes.filter((note) => note.sample !== undefined).map((note) => <div key={note.id} data-sample={note.id}><PreviewSheet title={note.title} sample={note.sample} /></div>)}
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : <p className="muted" role="status">
      {archive ? "Your backup is ready." : `Preparing ${done} of ${library.notes.length} documents…`}
    </p>}
    <div className="dialog-actions">
      <button className="button secondary" onClick={onClose}>{archive || error ? "Close" : "Cancel"}</button>
      {error && <button className="button primary" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
      {archive && <a className="button primary backup-download" href={archive} download="gods-note-backup.zip"><Download size={17} /> Download ZIP</a>}
    </div>
  </Dialog>;
}
