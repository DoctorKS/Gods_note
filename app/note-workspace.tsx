"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import type { Session } from "@supabase/supabase-js";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Cloud, Download, Ellipsis, FilePlus2, Folder, FolderOpen, Grid2X2, Images, LogOut, Pencil, Plus, RotateCcw, ScanLine, Search, Trash2, X } from "lucide-react";
import { cloudRepository, demoRepository, supabase } from "../lib/repository";
import { assertNoteNameAvailable, buddhistYear, LAST_BUDDHIST_YEAR, yearTitle, type Collection, type Library, type Note, type NoteRepository } from "../lib/models";
import { Dialog, MediaImage, PreviewSheet } from "./ui";

const BatchImport = dynamic(() => import("./batch-import").then((module) => module.BatchImport));
const NoteEditor = dynamic(() => import("./note-editor").then((module) => module.NoteEditor));
const WoundUpload = dynamic(() => import("./wound-upload").then((module) => module.WoundUpload));
const BackupDialog = dynamic(() => import("./backup-dialog").then((module) => module.BackupDialog));
const titleOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const tableKey = (group: Collection) => group.year === undefined ? group.id : `year-${group.year}`;

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
  const [currentYear] = useState(() => buddhistYear());
  const currentYearKey = `year-${currentYear}`;
  const [collection, setCollection] = useState(currentYearKey);
  const [modal, setModal] = useState<"collection" | "blank" | "upload" | "batch" | "wound" | "backup" | "trash">();
  const [openNote, setOpenNote] = useState<Note>();
  const [tableToTrash, setTableToTrash] = useState<Collection>();
  const [documentAction, setDocumentAction] = useState<{ kind: "menu" | "rename" | "delete"; note: Note }>();
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

  const activeLibrary = useMemo(() => {
    if (!library) return undefined;
    const collections = library.collections.filter((group) => !group.trashedAt);
    const activeIds = new Set(collections.map(({ id }) => id));
    return { collections, notes: library.notes.filter((note) => activeIds.has(note.collectionId)) };
  }, [library]);

  const visible = useMemo(() => {
    const groups = new Map<string, Note[]>();
    const text = query.trim().toLocaleLowerCase();
    for (const note of activeLibrary?.notes ?? []) {
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
  }, [activeLibrary, query, sort, ascending]);

  function showNote(note: Note) {
    setScrollPosition(window.scrollY);
    setOpenNote(note);
    window.scrollTo(0, 0);
  }

  function returnToLibrary() {
    setOpenNote(undefined);
    requestAnimationFrame(() => window.scrollTo(0, scrollPosition));
  }

  const collections = activeLibrary?.collections ?? [];
  const trash = library?.collections.filter((group) => group.trashedAt) ?? [];
  const currentYearTable = collections.find(({ year }) => year === currentYear);
  const activeTable = collections.find((group) => tableKey(group) === collection);
  const destination = collection ? activeTable : currentYearTable ?? collections[0];
  const shownGroups = collections.filter((group) => (!collection || tableKey(group) === collection) && (!query.trim() || visible.has(group.id)));
  const visibleCount = shownGroups.reduce((count, group) => count + (visible.get(group.id)?.length ?? 0), 0);

  async function setTableTrashed(table: Collection, trashed: boolean) {
    const updated = await repository.setCollectionTrashed(table.id, trashed);
    setLibrary((current) => current && ({ ...current, collections: current.collections.map((group) => group.id === updated.id ? updated : group) }));
    if (trashed) {
      if (collection === tableKey(table)) { setCollection(currentYearKey); setQuery(""); }
      setTableToTrash(undefined);
      setNotice("Table moved to Trash.");
    } else {
      setCollection(tableKey(updated));
      setQuery("");
      setModal(undefined);
      setNotice("Table restored.");
    }
  }

  const renameDialog = documentAction?.kind === "rename" && <RenameDialog note={documentAction.note} onClose={() => setDocumentAction(undefined)} onSubmit={async (title) => {
    const { id } = documentAction.note;
    assertNoteNameAvailable(library?.notes ?? [], title, id);
    await repository.renameNote(id, title);
    setLibrary((current) => current && ({ ...current, notes: current.notes.map((note) => note.id === id ? { ...note, title } : note) }));
    setOpenNote((current) => current?.id === id ? { ...current, title } : current);
    setDocumentAction(undefined);
  }} />;

  if (openNote) return <>
    <NoteEditor note={openNote} repository={repository} onBack={returnToLibrary} onRename={() => setDocumentAction({ kind: "rename", note: openNote })} />
    {renameDialog}
  </>;

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
        {collections.map((group) => <button key={group.id} className={collection === tableKey(group) ? "sidebar-item selected" : "sidebar-item"} onClick={() => setCollection(tableKey(group))}><Folder size={17} /> <span>{group.title}</span></button>)}
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
          <div><span className="eyebrow blue-label">YOUR NOTEBOOK LIBRARY</span><h1>My notes</h1><p>{activeTable?.title ?? (library && collection === currentYearKey ? yearTitle(currentYear) : "Collect, scan, and write in one place.")}</p></div>
          <div className="heading-actions">
            <button className="button secondary" disabled={!activeLibrary?.notes.length} onClick={() => setModal("backup")}><Download size={17} /> Backup</button>
            <button className="button secondary" disabled={!library} onClick={() => setModal("trash")}><Trash2 size={17} /> Trash{trash.length > 0 && <span className="count-badge">{trash.length}</span>}</button>
            <button className="button secondary" disabled={!destination} onClick={() => { setNotice(""); setModal("blank"); }}><FilePlus2 size={17} /> Blank note</button>
            <button className="button primary" disabled={!library} onClick={() => { setNotice(""); setModal("upload"); }}><Plus size={19} /> Add documents</button>
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
                  <div className="collection-heading">
                    <span className="folder-icon"><Folder size={16} /></span><h2>{group.title}</h2><span className="count-badge">{notes.length}</span>
                    <button className="button text-button table-trash-button" type="button" aria-label={`Move ${group.title} to Trash`} onClick={() => setTableToTrash(group)}>
                      <Trash2 size={16} /> Move to Trash
                    </button>
                  </div>
                  {notes.length > 0 ? <div className="note-grid">{notes.map((note) =>
                    <div className="note-tile" key={note.id}>
                      <button className="note-card" type="button" title={note.title} onClick={() => showNote(note)}>
                        <span className="note-cover">{note.cover ? <MediaImage source={note.cover} repository={repository} className="cover-image" lazy /> : <PreviewSheet title={note.title} sample={note.sample} />}</span>
                        <span className="note-name">{note.title}</span>
                      </button>
                      <button className="icon-button note-options" type="button" aria-label={`Actions for ${note.title}`} title="Document actions" onClick={() => setDocumentAction({ kind: "menu", note })}>
                        <Ellipsis size={18} />
                      </button>
                    </div>)}</div> : <div className="empty-collection"><Images size={21} /><span>Add a document or blank note to this table.</span></div>}
                </section>;
              })}
            </div>
          </>}
      </main>
    </div>
    {(modal === "collection" || modal === "blank") && <CreateDialog kind={modal} collections={collections} currentYear={currentYear} destination={destination?.id} onClose={() => setModal(undefined)} onSubmit={async (title, collectionId, id, year) => {
      if (modal === "collection") {
        const group = await repository.createCollection({ id, title, year });
        setLibrary((current) => current && ({ ...current, collections: [...current.collections.filter((entry) => entry.id !== group.id), group] }));
        setCollection(tableKey(group));
        setQuery("");
      } else {
        assertNoteNameAvailable(library?.notes ?? [], title, id);
        const note = await repository.createNote({ id, title, collectionId });
        addNote(note);
        showNote(note);
      }
      setModal(undefined);
    }} />}
    {modal === "upload" && <Dialog title="Add documents" description="Choose how to add pages to your library." onClose={() => setModal(undefined)}>
      <div className="document-actions">
        <button className="button secondary" disabled={!destination} onClick={() => setModal("batch")}><ScanLine size={17} /> Upload documents</button>
        <button className="button secondary" disabled={!activeLibrary?.notes.length} onClick={() => setModal("wound")}><Images size={17} /> Upload wound photos</button>
      </div>
      {!destination && <p className="muted">Add the year table first to upload a new document.</p>}
    </Dialog>}
    {modal === "batch" && <BatchImport collections={collections} notes={library?.notes ?? []} destination={destination?.id ?? ""} repository={repository}
      onSaved={addNote} onClose={() => setModal(undefined)} onDone={(count, collectionId) => {
        const group = collections.find(({ id }) => id === collectionId);
        setModal(undefined); setQuery(""); if (group) setCollection(tableKey(group));
        setNotice(`${count} ${count === 1 ? "document" : "documents"} saved.`);
      }} />}
    {modal === "wound" && activeLibrary && <WoundUpload library={activeLibrary} repository={repository} destination={destination?.id}
      onClose={() => setModal(undefined)} onDone={(note) => { setModal(undefined); showNote(note); }} />}
    {modal === "backup" && activeLibrary && <BackupDialog library={activeLibrary} repository={repository} onClose={() => setModal(undefined)} />}
    {modal === "trash" && library && <TrashDialog tables={trash} notes={library.notes} onClose={() => setModal(undefined)}
      onRestore={(table) => setTableTrashed(table, false)} />}
    {tableToTrash && <ConfirmRemoveDialog title="Move table to Trash?"
      description={`“${tableToTrash.title}” and its documents will move to Trash. You can restore the whole table there.`}
      action="Move to Trash" pending="Moving…" onClose={() => setTableToTrash(undefined)} onConfirm={() => setTableTrashed(tableToTrash, true)} />}
    {documentAction?.kind === "menu" && <Dialog title={documentAction.note.title} description="Document actions" onClose={() => setDocumentAction(undefined)}>
      <div className="document-actions">
        <button className="button secondary" onClick={() => setDocumentAction({ kind: "rename", note: documentAction.note })}><Pencil size={17} /> Rename</button>
        <button className="button secondary danger-text" onClick={() => setDocumentAction({ kind: "delete", note: documentAction.note })}><Trash2 size={17} /> Delete</button>
      </div>
    </Dialog>}
    {renameDialog}
    {documentAction?.kind === "delete" && <ConfirmRemoveDialog title="Delete document?"
      description={`“${documentAction.note.title}” and its pages will be permanently deleted.`}
      action="Delete document" pending="Deleting…" onClose={() => setDocumentAction(undefined)} onConfirm={async () => {
        const { id } = documentAction.note;
        await repository.deleteNote(id);
        setLibrary((current) => current && ({ ...current, notes: current.notes.filter((note) => note.id !== id) }));
        setDocumentAction(undefined);
        setNotice("Document deleted.");
      }} />}
  </div>;
}

function TrashDialog({ tables, notes, onClose, onRestore }: {
  tables: Collection[];
  notes: Note[];
  onClose: () => void;
  onRestore: (table: Collection) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function restore(table: Collection) {
    if (busy) return;
    setBusy(table.id);
    setError("");
    try { await onRestore(table); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not restore this table."); }
    finally { setBusy(""); }
  }

  return <Dialog title="Trash" description="Restore a table to return it and its documents to the library." onClose={onClose} busy={Boolean(busy)}>
    {tables.length === 0 ? <p className="muted">Trash is empty.</p> : <ul className="trash-list">
      {tables.map((table) => {
        const count = notes.filter((note) => note.collectionId === table.id).length;
        return <li key={table.id}>
          <span className="folder-icon"><Folder size={16} /></span>
          <div className="trash-table-name"><strong>{table.title}</strong><small>{count} {count === 1 ? "document" : "documents"}</small></div>
          <button className="button secondary" disabled={Boolean(busy)} aria-label={`Restore ${table.title}`} onClick={() => void restore(table)}>
            <RotateCcw size={16} /> {busy === table.id ? "Restoring…" : "Restore"}
          </button>
        </li>;
      })}
    </ul>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={onClose}>Close</button></div>
  </Dialog>;
}

function RenameDialog({ note, onClose, onSubmit }: {
  note: Note;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const title = String(new FormData(event.currentTarget).get("title")).trim();
    if (!title) { setError("Enter a document name."); return; }
    if (title === note.title) { onClose(); return; }
    setError("");
    setBusy(true);
    try { await onSubmit(title); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename this document.");
      setBusy(false);
    }
  }

  return <Dialog title="Rename document" description="Enter a new name for this document." onClose={onClose} busy={busy}>
    <form className="form-stack" onSubmit={submit}>
      <label>Document name<input name="title" autoFocus onFocus={(event) => event.currentTarget.select()} required maxLength={160} defaultValue={note.title} readOnly={busy} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save name"}</button>
      </div>
    </form>
  </Dialog>;
}

function ConfirmRemoveDialog({ title, description, action, pending, onClose, onConfirm }: {
  title: string;
  description: string;
  action: string;
  pending: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (busy) return;
    setError("");
    setBusy(true);
    try { await onConfirm(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete the action.");
      setBusy(false);
    }
  }

  return <Dialog title={title} description={description} onClose={onClose} busy={busy}>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button className="button secondary" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      <button className="button danger" disabled={busy} onClick={() => void confirm()}>{busy ? pending : action}</button>
    </div>
  </Dialog>;
}

function CreateDialog({ kind, collections, currentYear, destination, onClose, onSubmit }: {
  kind: "collection" | "blank";
  collections: Collection[];
  currentYear: number;
  destination?: string;
  onClose: () => void;
  onSubmit: (title: string, collectionId: string, id: string, year?: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const isTable = kind === "collection";
  const years = Array.from({ length: Math.max(0, LAST_BUDDHIST_YEAR - currentYear + 1) }, (_, offset) => currentYear + offset);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const year = isTable ? Number(data.get("year")) : undefined;
    const title = year ? yearTitle(year) : String(data.get("title") ?? "").trim();
    if (!title) { setError("Enter a name."); return; }
    setError("");
    setBusy(true);
    try { await onSubmit(title, String(data.get("collection") ?? ""), id, year); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save."); }
    finally { setBusy(false); }
  }

  return <Dialog title={isTable ? "Add table" : "New blank note"} description={isTable ? "Create a new group for your notes." : "Start writing on a blank page."} onClose={onClose} busy={busy}>
    <form className="form-stack" onSubmit={submit}>
      {isTable ? <label>ปี พ.ศ.<select name="year" aria-label="ปี พ.ศ." autoFocus required defaultValue={currentYear}>
        {years.map((year) => <option key={year} value={year}>{yearTitle(year)}</option>)}
      </select></label> : <label>Note name<input name="title" autoFocus required maxLength={160} placeholder="e.g. Lecture notes" /></label>}
      {!isTable && <label>Table<select name="collection" aria-label="Table" defaultValue={destination || collections[0]?.id} required>{collections.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || (isTable && years.length === 0)}>{busy ? "Saving…" : "Create"}</button></div>
    </form>
  </Dialog>;
}
