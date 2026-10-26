import { tr, tServer } from './i18n';
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T = any>(url: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-gt': '1' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, tr('ما في اتصال بالإنترنت أو الخادم مو شغال'));
  }
  if (res.status === 401 && !url.startsWith('/auth')) {
    window.dispatchEvent(new Event('gt:unauthorized'));
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const msg = ct.includes('json') ? tServer((await res.json()).error) : tr('خطأ {0}', [res.status]);
    throw new ApiError(res.status, msg || tr('خطأ {0}', [res.status]));
  }
  if (ct.includes('json')) return res.json();
  return (await res.blob()) as unknown as T;
}

export async function apiBlob(url: string, opts: Opts = {}): Promise<Blob> {
  const headers: Record<string, string> = { 'x-gt': '1' };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${url}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', signal: opts.signal });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    const msg = ct.includes('json') ? tServer((await res.json()).error) : tr('خطأ {0}', [res.status]);
    throw new ApiError(res.status, msg);
  }
  return res.blob();
}

/** Trigger a download of an API resource (keeps auth cookie). */
export async function downloadFrom(url: string, fallbackName: string) {
  const res = await fetch(`/api${url}`, { credentials: 'same-origin', headers: { 'x-gt': '1' } });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    throw new ApiError(res.status, ct.includes('json') ? tServer((await res.json()).error) : tr('خطأ {0}', [res.status]));
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(cd);
  const name = m ? decodeURIComponent(m[1] || m[2]) : fallbackName;
  saveBlob(blob, name);
  return { blob, name };
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Share a file via the native share sheet (mobile), falling back to download. */
export async function shareBlob(blob: Blob, name: string, title: string) {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as any;
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  saveBlob(blob, name);
  return 'downloaded';
}
