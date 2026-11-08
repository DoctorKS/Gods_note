"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import type { Session } from "@supabase/supabase-js";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Cloud, FilePlus2, Folder, FolderOpen, Grid2X2, Images, LogOut, Plus, Search, X } from "lucide-react";
import { cloudRepository, demoRepository, supabase } from "../lib/repository";
import type { Collection, Library, Note, NoteRepository } from "../lib/models";
import { Dialog, MediaImage, PreviewSheet } from "./ui";

const BatchImport = dynamic(() => import("./batch-import").then((module) => module.BatchImport));
const NoteEditor = dynamic(() => import("./note-editor").then((module) => module.NoteEditor));
const titleOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function NoteWorkspace() {
  const [session, setSession] = useState<Session | null>();
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);
  const accountId = session?.user.id;
  const repository = useMemo(() => accountId ? cloudRepository(accountId) : demoRepository, [accountId]);

  if (supabase && session === undefined) return <main className="loading-screen">Opening Gods Note…</main>;
  if (supabase && !session) return <AuthScreen />;
  return <Workspace key={accountId ?? "demo"} repository={repository} email={session?.user.email} />;
}

function Brand() {
  return <div className="brand"><span className="brand-icon"><BookOpen size={20} strokeWidth={2.2} /></span><span>Gods Note</span></div>;
}

function AuthScreen() {
  const [register, setRegister] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    const form = new FormData(event.currentTarget);
    const credentials = { email: String(form.get("email")).trim(), password: String(form.get("password")) };
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = register ? await supabase.auth.signUp({
        ...credentials, options: { emailRedirectTo: window.location.origin },
      }) : await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;
      if (register && !data.session) setMessage("Check your email to confirm your account.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen">
    <section className="auth-card">
      <Brand />
      <h1>{register ? "Create your library" : "Welcome back"}</h1>
      <p>Open your notes and scanned documents on any device.</p>
      <form onSubmit={submit} className="form-stack">
        <label>Email<input required type="email" name="email" autoComplete="email" /></label>
        <label>Password<input required type="password" name="password" minLength={6} autoComplete={register ? "new-password" : "current-password"} /></label>
        {message && <p role="status">{message}</p>}
        <button className="button primary" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
        <button type="button" className="button text-button" disabled={busy} onClick={() => { setRegister(!register); setMessage(""); }}>
          {register ? "Use an existing account" : "Create an account"}
        </button>
      </form>
    </section>
  </main>;
}

function Workspace({ repository, email }: { repository: NoteRepository; email?: string }) {
  const [library, setLibrary] = useState<Library>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "date">("date");
  const [ascending, setAscending] = useState(false);
  const [collection, setCollection] = useState("");
  const [modal, setModal] = useState<"collection" | "blank" | "batch">();
  const [openNote, setOpenNote] = useState<Note>();
  const [scrollPosition, setScrollPosition] = useState(0);
  const [notice, setNotice] = useState("");

  const loadLibrary = useCallback(async () => {
    setError("");
    try { setLibrary(await repository.list()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load your library."); }
  }, [repository]);
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  const addNote = useCallback((note: Note) => {
    setLibrary((current) => current && ({ ...current, notes: [...current.notes.filter(({ id }) => id !== note.id), note] }));
  }, []);

  const visible = useMemo(() => {
    const groups = new Map<string, Note[]>();
    const text = query.trim().toLocaleLowerCase();
    for (const note of library?.notes ?? []) {
      if (text && !note.title.toLocaleLowerCase().includes(text)) continue;
      const notes = groups.get(note.collectionId) ?? [];
      notes.push(note);
      groups.set(note.collectionId, notes);
    }
    for (const notes of groups.values()) notes.sort((first, second) => {
      const order = sort === "name" ? titleOrder.compare(first.title, second.title) : Date.parse(first.createdAt) - Date.parse(second.createdAt);
      return (ascending ? order : -order) || first.id.localeCompare(second.id);
    });
    return groups;
  }, [library, query, sort, ascending]);

  function showNote(note: Note) {
    setScrollPosition(window.scrollY);
    setOpenNote(note);
    window.scrollTo(0, 0);
  }

  function returnToLibrary() {
    setOpenNote(undefined);
    requestAnimationFrame(() => window.scrollTo(0, scrollPosition));
  }

  const collections = library?.collections ?? [];
  const shownGroups = collections.filter(({ id }) => (!collection || id === collection) && (!query.trim() || visible.has(id)));
  const visibleCount = shownGroups.reduce((count, group) => count + (visible.get(group.id)?.length ?? 0), 0);

  if (openNote) return <NoteEditor note={openNote} repository={repository} onBack={returnToLibrary} />;

  return <div className="workspace">
    <header className="topbar">
      <div className="topbar-inner"><Brand /><div className="topbar-right">
        <span className="connection"><span className={supabase ? "status-dot cloud-dot" : "status-dot"} />{supabase ? "Cloud library" : "Local demo"}</span>
        <span className="avatar" title={email ?? "Demo workspace"}>{email ? email[0].toUpperCase() : "G"}</span>
      </div></div>
    </header>
    <div className="library-layout">
      <aside className="sidebar">
        <span className="eyebrow">WORKSPACE</span>
        <button className={collection ? "sidebar-item" : "sidebar-item selected"} onClick={() => setCollection("")}><Grid2X2 size={17} /> All notes</button>
        <div className="sidebar-heading"><span className="eyebrow">TABLES</span><button className="icon-button" aria-label="Add a table" onClick={() => setModal("collection")} disabled={!library}><Plus size={17} /></button></div>
        {collections.map((group) => <button key={group.id} className={collection === group.id ? "sidebar-item selected" : "sidebar-item"} onClick={() => setCollection(group.id)}><Folder size={17} /> <span>{group.title}</span></button>)}
        <div className="sidebar-footer">
          {supabase ? <button className="sidebar-item" onClick={async () => {
            if (!supabase) return;
            const { error: signOutError } = await supabase.auth.signOut();
            if (signOutError) setNotice(signOutError.message);
          }}><LogOut size={17} /> Sign out</button> :
            <div className="demo-tip"><Cloud size={16} /><span>Demo notes are stored in this browser.</span></div>}
        </div>
      </aside>
      <main className="library-main">
        <section className="library-heading">
          <div><span className="eyebrow blue-label">YOUR NOTEBOOK LIBRARY</span><h1>My notes</h1><p>Collect, scan, and write in one place.</p></div>
          <div className="heading-actions">
            <button className="button secondary" disabled={!collections.length} onClick={() => { setNotice(""); setModal("blank"); }}><FilePlus2 size={17} /> Blank note</button>
            <button className="button primary" disabled={!collections.length} onClick={() => { setNotice(""); setModal("batch"); }}><Plus size={19} /> Add documents</button>
          </div>
        </section>
        {notice && <p className="notice" role="status">{notice}<button className="icon-button" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={16} /></button></p>}
        {error ? <div className="empty-state" role="alert"><p>{error}</p><button className="button secondary" onClick={loadLibrary}>Try again</button></div> :
          !library ? <p className="loading-library" role="status">Loading your notes…</p> : <>
            <div className="library-controls">
              <label className="search-box"><Search size={18} /><input type="search" placeholder="Search file name" aria-label="Search file name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <div className="sort-controls">
                <label className="select-wrap"><span className="sort-label">Sort by</span><select aria-label="Sort by" value={sort} onChange={(event) => setSort(event.target.value as "name" | "date")}><option value="name">File name</option><option value="date">Date created</option></select><ChevronDown size={14} /></label>
                <button className="button secondary sort-direction" onClick={() => setAscending(!ascending)} title="Change sort direction" aria-label={ascending ? "Ascending. Switch to descending" : "Descending. Switch to ascending"}>
                  {ascending ? <ArrowUp size={16} /> : <ArrowDown size={16} />}{ascending ? "Ascending" : "Descending"}
                </button>
              </div>
            </div>
            <div className="grid-toolbar">
              <span>{visibleCount} {visibleCount === 1 ? "note" : "notes"}</span>
              <button className="button text-button" onClick={() => setModal("collection")}><Plus size={16} /> Add table</button>
            </div>
            {shownGroups.length === 0 && <div className="empty-state"><FolderOpen size={30} /><h2>{query.trim() ? "No matching notes" : "Your library is empty"}</h2><p>{query.trim() ? "Try a different file name." : "Add a table to start organizing notes."}</p></div>}
            <div className="collection-list">
              {shownGroups.map((group) => {
                const notes = visible.get(group.id) ?? [];
                return <section className="collection" key={group.id} aria-label={group.title}>
                  <div className="collection-heading"><span className="folder-icon"><Folder size={16} /></span><h2>{group.title}</h2><span className="count-badge">{notes.length}</span></div>
                  {notes.length > 0 ? <div className="note-grid">{notes.map((note) =>
                    <button className="note-card" key={note.id} type="button" title={note.title} onClick={() => showNote(note)}>
                      <span className="note-cover">{note.cover ? <MediaImage source={note.cover} repository={repository} className="cover-image" lazy /> : <PreviewSheet title={note.title} sample={note.sample} />}</span>
                      <span className="note-name">{note.title}</span>
                    </button>)}</div> : <div className="empty-collection"><Images size={21} /><span>Add a document or blank note to this table.</span></div>}
                </section>;
              })}
            </div>
          </>}
      </main>
    </div>
    {(modal === "collection" || modal === "blank") && <CreateDialog kind={modal} collections={collections} destination={collection} onClose={() => setModal(undefined)} onSubmit={async (title, collectionId, id) => {
      if (modal === "collection") {
        const group = await repository.createCollection({ id, title });
        setLibrary((current) => current && ({ ...current, collections: [...current.collections.filter((entry) => entry.id !== group.id), group] }));
        setCollection(group.id);
        setQuery("");
      } else {
        const note = await repository.createNote({ id, title, collectionId });
        addNote(note);
        showNote(note);
      }
      setModal(undefined);
    }} />}
    {modal === "batch" && <BatchImport collections={collections} destination={collection} repository={repository}
      onSaved={addNote} onClose={() => setModal(undefined)} onDone={(count, collectionId) => {
        setModal(undefined); setQuery(""); setCollection(collectionId);
        setNotice(`${count} ${count === 1 ? "document" : "documents"} saved.`);
      }} />}
  </div>;
}

function CreateDialog({ kind, collections, destination, onClose, onSubmit }: {
  kind: "collection" | "blank";
  collections: Collection[];
  destination: string;
  onClose: () => void;
  onSubmit: (title: string, collectionId: string, id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const isTable = kind === "collection";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title")).trim();
    if (!title) { setError("Enter a name."); return; }
    setError("");
    setBusy(true);
    try { await onSubmit(title, String(data.get("collection") ?? ""), id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save."); }
    finally { setBusy(false); }
  }

  return <Dialog title={isTable ? "Add table" : "New blank note"} description={isTable ? "Create a new group for your notes." : "Start writing on a blank page."} onClose={onClose} busy={busy}>
    <form className="form-stack" onSubmit={submit}>
      <label>{isTable ? "Table name" : "Note name"}<input name="title" autoFocus required maxLength={isTable ? 100 : 160} placeholder={isTable ? "e.g. Study notes" : "e.g. Lecture notes"} /></label>
      {!isTable && <label>Table<select name="collection" aria-label="Table" defaultValue={destination || collections[0]?.id} required>{collections.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Create"}</button></div>
    </form>
  </Dialog>;
}
