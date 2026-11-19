import { Download, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import type { Attachment } from '../types';

type FileData = { fileName: string; mimeType: string; base64: string };
export type ViewKind = 'pdf' | 'image' | 'other';

/** PDFs and pictures open inside eRFA; Word files are downloaded. */
export function viewKind(attachment: Pick<Attachment, 'FILE_NAME' | 'MIME_TYPE'>): ViewKind {
  const mime = String(attachment.MIME_TYPE || '').toLowerCase();
  const name = String(attachment.FILE_NAME || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(jpe?g|png)$/.test(name)) return 'image';
  return 'other';
}

/** Ask eRFA for the file (it stays private in the school's Drive) and make it a Blob. */
export async function fetchAttachment(attachment: Attachment): Promise<{ blob: Blob; fileName: string }> {
  const file = await api<FileData>('attachment.download', { attachmentId: attachment.ATTACHMENT_ID });
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  return { blob: new Blob([bytes], { type: file.mimeType }), fileName: file.fileName };
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Draw every page of a PDF into `host`, sized to its width (works the same on phones and computers).
 *  isEvalSupported: false keeps a crafted PDF font from running code (CVE-2024-4367). */
async function renderPdf(blob: Blob, host: HTMLElement, isCancelled: () => boolean): Promise<void> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.js?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const width = Math.max(280, host.clientWidth - 2);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (let number = 1; number <= pdf.numPages; number += 1) {
      if (isCancelled()) return;
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.setAttribute('aria-label', `Page ${number} of ${pdf.numPages}`);
      host.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    }
  } finally { void pdf.destroy(); }
}

export function AttachmentViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const kind = viewKind(attachment);
  const [file, setFile] = useState<{ blob: Blob; fileName: string } | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let url = '';
    setRendering(true);
    fetchAttachment(attachment)
      .then(async (loaded) => {
        if (cancelled) return;
        setFile(loaded);
        if (kind === 'image') { url = URL.createObjectURL(loaded.blob); setImageUrl(url); setRendering(false); return; }
        if (pagesRef.current) {
          pagesRef.current.replaceChildren();
          await renderPdf(loaded.blob, pagesRef.current, () => cancelled);
        }
        if (!cancelled) setRendering(false);
      })
      .catch((caught: unknown) => { if (!cancelled) { setError(caught instanceof Error ? caught.message : 'The file could not be opened.'); setRendering(false); } });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [attachment, kind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  return createPortal(<div className="attachment-viewer" role="dialog" aria-modal="true" aria-label={attachment.FILE_NAME}>
    <header>
      <b title={attachment.FILE_NAME}>{attachment.FILE_NAME}</b>
      <button className="button secondary" disabled={!file} onClick={() => file && saveBlob(file.blob, file.fileName)}><Download size={16} /> Download</button>
      <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
    </header>
    <div className="attachment-viewer-body">
      {error && <div className="notice error" role="alert">{error}</div>}
      {rendering && !error && <div className="attachment-viewer-loading" role="status"><LoaderCircle size={22} className="spin" /> Opening the file…</div>}
      {kind === 'image' && imageUrl && <img src={imageUrl} alt={attachment.FILE_NAME} />}
      {kind === 'pdf' && <div ref={pagesRef} className="attachment-viewer-pages" />}
    </div>
  </div>, document.body);
}
