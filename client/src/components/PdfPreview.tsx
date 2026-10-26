import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Loader2 } from 'lucide-react';
import { cx } from './ui';
import { tr } from '../lib/i18n';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Renders a PDF blob into crisp canvases (works on iOS + Android, unlike <iframe>). */
export default function PdfPreview({ blob, loading, className }: { blob: Blob | null; loading?: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || !host.current) return;
    let cancelled = false;
    const el = host.current;
    (async () => {
      setRendering(true);
      setErr(null);
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        const task = pdfjs.getDocument({ data });
        const doc = await task.promise;
        const width = el.clientWidth || 600;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const canvases: HTMLCanvasElement[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const base = page.getViewport({ scale: 1 });
          const scale = (width / base.width) * dpr;
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block rounded-lg bg-white shadow-[0_2px_10px_rgb(0_0_0/0.08)] ring-1 ring-gray-200';
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          if (cancelled) return;
          canvases.push(canvas);
        }
        if (cancelled) return;
        el.replaceChildren(...canvases.map((c) => {
          const wrap = document.createElement('div');
          wrap.className = 'mb-3';
          wrap.appendChild(c);
          return wrap;
        }));
        task.destroy();
      } catch (e: any) {
        if (!cancelled) setErr(tr('ما قدرت إعرض المعاينة'));
        console.error(e);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [blob]);

  return (
    <div className={cx('relative', className)}>
      <div ref={host} className={cx('transition-opacity', (loading || rendering) && 'opacity-60')}>
        {!blob && <div className="aspect-[1/1.414] animate-pulse rounded-lg bg-gray-100" />}
      </div>
      {(loading || rendering) && (
        <div className="pointer-events-none absolute top-3 start-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-gray-600 shadow">
          <Loader2 className="size-3.5 animate-spin" /> {tr('تحديث')}
        </div>
      )}
      {err && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
    </div>
  );
}
