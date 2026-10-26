import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, AlertTriangle, Paperclip } from 'lucide-react';
import type { Entry } from '../lib/types';
import { fmtDayMonth, methodLabel } from '../lib/format';
import { Money, cx } from './ui';

export function Thumb({ entry, className }: { entry: Entry; className?: string }) {
  const f = entry.files[0];
  if (!f) {
    return (
      <div className={cx('flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500', className)}>
        <AlertTriangle className="size-5" />
      </div>
    );
  }
  if (f.mime.startsWith('image/') && !f.mime.includes('hei')) {
    return <img src={`/api/files/${f.id}`} alt="" loading="lazy" className={cx('size-12 shrink-0 rounded-xl object-cover ring-1 ring-gray-200', className)} />;
  }
  return (
    <div className={cx('flex size-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500', className)}>
      <FileText className="size-5" />
    </div>
  );
}

export default function EntryRow({ entry, income }: { entry: Entry; income?: boolean }) {
  return (
    <Link to={`/entry/${entry.id}`} className="flex items-center gap-3 p-3.5 transition hover:bg-gray-50 active:bg-gray-100">
      <Thumb entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-gray-900">{entry.vendor || entry.description || 'بدون اسم'}</div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>{fmtDayMonth(entry.date)}</span>
          {entry.folder !== 'bank' && <><span>·</span><span>{methodLabel(entry.payment_method)}</span></>}
          {entry.files.length > 1 && <><span>·</span><Paperclip className="size-3" /><span className="num">{entry.files.length}</span></>}
          {!entry.files.length && <span className="font-semibold text-amber-600">· بدون إيصال</span>}
        </div>
      </div>
      {entry.amount_cents > 0 && <Money cents={entry.amount_cents} className={cx('font-bold', income ? 'text-emerald-700' : 'text-gray-900')} />}
    </Link>
  );
}
