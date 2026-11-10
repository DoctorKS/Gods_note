import { Zip, ZipPassThrough } from "fflate";
import { drawStroke } from "./ink";
import { A4_HEIGHT, A4_WIDTH, MAX_WOUND_BYTES, type Library, type NotePage, type NoteRepository } from "./models";
import { canvasAt, context2d, jpeg, jpegForUpload, loadImage } from "./scanner";

function folderName(title: string, used: Set<string>) {
  const sanitized = Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")).slice(0, 64).join("").replace(/^[. ]+|[. ]+$/g, "") || "Untitled";
  const base = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized) ? "_" + sanitized : sanitized;
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base} (${index++})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

async function pageJpeg(page: NotePage, background?: Blob) {
  if (background?.type === "image/jpeg" && !page.strokes.length) return background;

  const height = page.kind === "wound" ? A4_HEIGHT : Math.min(1800, 1800 / page.ratio);
  const width = page.kind === "wound" ? A4_WIDTH : height * page.ratio;
  const canvas = canvasAt(width, height);
  const context = context2d(canvas);
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (background) {
    const image = await loadImage(background, 1800);
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  } else {
    context.strokeStyle = "#e1e8f4";
    context.lineWidth = Math.max(1, canvas.height / 880);
    for (let y = canvas.height / 30; y < canvas.height; y += canvas.height / 30) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
  }

  if (page.strokes.length) {
    // Render onto a transparent layer so eraser strokes never cut the background.
    const ink = canvasAt(canvas.width, canvas.height);
    const inkContext = ink.getContext("2d");
    if (!inkContext) throw new Error("Your browser could not render the note's ink.");
    for (const stroke of page.strokes) drawStroke(inkContext, stroke, ink.width, ink.height);
    context.drawImage(ink, 0, 0);
  }

  if (page.kind === "wound") return (await jpegForUpload(canvas, 0.92, MAX_WOUND_BYTES, true)).blob;
  return jpeg(canvas, 0.92);
}

export async function exportBackup(library: Library, repository: NoteRepository, signal: AbortSignal, onProgress: (done: number) => void, sampleArtwork: (id: string) => Blob | undefined) {
  const chunks: BlobPart[] = [];
  let failure: Error | undefined;
  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else chunks.push(data as Uint8Array<ArrayBuffer>);
  });
  const usedTables = new Set<string>();
  let done = 0;

  function addFile(path: string, data: Uint8Array) {
    const file = new ZipPassThrough(path);
    zip.add(file);
    file.push(data, true);
    if (failure) throw failure;
  }

  try {
    for (const group of library.collections) {
      const table = folderName(group.title, usedTables);
      const documents = library.notes.filter((note) => note.collectionId === group.id);
      const usedDocuments = new Set<string>();
      addFile(table + "/", new Uint8Array());
      for (const note of documents) {
        signal.throwIfAborted();
        const path = table + "/" + folderName(note.title, usedDocuments);
        for (const page of await repository.openNote(note.id)) {
          signal.throwIfAborted();
          let background: Blob | undefined;
          if (typeof page.background === "string") {
            const response = await fetch(await repository.imageUrl(page.background), { signal });
            if (!response.ok) throw new Error("A page image could not be downloaded. Try again.");
            background = await response.blob();
          } else {
            background = page.background ?? (page.number === 1 ? sampleArtwork(note.id) : undefined);
          }
          const jpg = await pageJpeg(page, background);
          signal.throwIfAborted();
          addFile(`${path}/${String(page.number).padStart(3, "0")}.jpg`, new Uint8Array(await jpg.arrayBuffer()));
        }
        onProgress(++done);
      }
    }
    zip.end();
    if (failure) throw failure;
    return new Blob(chunks, { type: "application/zip" });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}
