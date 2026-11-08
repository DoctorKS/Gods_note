"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, X } from "lucide-react";
import type { NoteRepository } from "../lib/models";

export function Dialog({ title, description, children, onClose, wide, busy }: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={ref} className={wide ? "dialog dialog-wide" : "dialog"} aria-labelledby="dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="dialog-head">
        <div><h2 id="dialog-title">{title}</h2><p>{description}</p></div>
        <button className="icon-button" type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20} /></button>
      </div>
      {children}
    </dialog>
  );
}

export function MediaImage({ source, repository, className, lazy, onError }: {
  source: string | Blob;
  repository: NoteRepository;
  className: string;
  lazy?: boolean;
  onError?: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(!lazy);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const errorHandler = useRef(onError);
  useEffect(() => { errorHandler.current = onError; }, [onError]);

  useEffect(() => {
    if (!lazy || near) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNear(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [lazy, near]);

  useEffect(() => {
    if (!near) return;
    let active = true;
    let objectUrl: string | undefined;
    if (typeof source === "string") {
      repository.imageUrl(source).then((value) => {
        if (active) setUrl(value);
      }).catch(() => {
        if (active) { setFailed(true); errorHandler.current?.(); }
      });
    } else {
      objectUrl = URL.createObjectURL(source);
      setUrl(objectUrl);
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [near, repository, source]);

  return <span ref={ref} className={className}>
    {url && !failed ? <img src={url} alt="" draggable={false} onError={() => { setFailed(true); onError?.(); }} /> :
      failed ? <FileText className="image-placeholder" aria-hidden="true" /> : null}
  </span>;
}

const inks = ["#214f6a", "#644ba1", "#355f91", "#87572e", "#a04653"];
const papers = ["#fbfcff", "#fffcf7", "#f8fcff", "#fffcf7", "#fffafa"];
const highlights = ["#cfead9", "#e3dbfb", "#d5e8fb", "#fae6bd", "#f7d7dd"];
const annotations = ["Leaf structure", "Reaction rates", "Forces and motion", "Quadratic functions", "The human heart"];

export function PreviewSheet({ title, sample }: { title: string; sample?: number }) {
  if (sample === undefined) return <span className="blank-paper" aria-hidden="true"><FileText size={25} strokeWidth={1.45} /></span>;
  const style = sample % inks.length;
  const ink = inks[style];
  return (
    <svg viewBox="0 0 120 148" className="sample-paper" aria-hidden="true">
      <rect width="120" height="148" fill={papers[style]} />
      {Array.from({ length: 13 }, (_, row) => <path key={row} d={`M0 ${20 + row * 10}h120`} stroke="#dfe5f0" strokeWidth=".55" />)}
      <path d="M15 0v148" stroke="#ead0d0" strokeWidth=".7" />
      <rect x="23" y="20" width="71" height="9" rx="3" fill={highlights[style]} />
      <text x="24" y="24" fill={ink} fontFamily="Georgia, serif" fontStyle="italic" fontSize="12">{title}</text>
      <text x="24" y="42" fill={ink} fontFamily="Georgia, serif" fontStyle="italic" fontSize="6.7">{sample < 5 ? annotations[style] : "Notes & observations"}</text>
      {style === 0 && <g fill="none" stroke={ink} strokeWidth="1.15" strokeLinecap="round">
        <path d="M42 92c-7-18 13-36 43-35-5 22-21 37-43 35Z" fill={highlights[style]} /><path d="m34 99 49-41M51 85l-2-14m13 5-1-12m7 7 9 2M54 83l12 4" />
      </g>}
      {style === 1 && <g fill="none" stroke={ink} strokeWidth="1.15" strokeLinejoin="round">
        <path d="M46 56h13m-10 0v17L37 92q-2 5 4 5h24q6 0 3-5L56 73V56" />
        <path d="m43 84-5 9q-2 4 4 4h23q5 0 3-4l-5-9Z" fill={highlights[style]} />
        <circle cx="83" cy="70" r="5" /><circle cx="94" cy="83" r="4" /><path d="m86 74 5 6" />
      </g>}
      {style === 2 && <g fill="none" stroke={ink} strokeWidth="1.1">
        <path d="M31 98V56m0 42h66M29 59l2-3 2 3m60 37 4 2-4 2" />
        <path d="M35 92c10 0 12-9 20-11 12-3 17-2 23-10l13-14" strokeWidth="1.8" />
        <path d="M40 75h49M40 87h49" opacity=".3" />
      </g>}
      {style === 3 && <g fill={ink} fontFamily="Georgia, serif" fontSize="8" fontStyle="italic">
        <text x="30" y="62">x² + 2x − 8 = 0</text><text x="38" y="77">(x + 4)(x − 2)</text>
        <rect x="42" y="86" width="44" height="13" rx="2" fill={highlights[style]} /><text x="48" y="95">x = 2, −4</text>
      </g>}
      {style === 4 && <g stroke={ink} strokeWidth="1.15" fill={highlights[style]}>
        <path d="M62 97c-10-7-25-17-25-29 0-12 16-16 25-4 9-12 25-8 25 4 0 12-15 22-25 29Z" />
        <path d="M44 77h10l4-7 6 13 4-6h12" fill="none" />
      </g>}
      <g stroke={ink} strokeWidth="1" strokeLinecap="round" opacity=".72">
        <path d="M26 110h56M26 120h43M26 130h64" />
        <circle cx="22" cy="110" r=".6" /><circle cx="22" cy="120" r=".6" /><circle cx="22" cy="130" r=".6" />
      </g>
    </svg>
  );
}
