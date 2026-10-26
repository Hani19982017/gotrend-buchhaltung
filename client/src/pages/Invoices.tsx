import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, FileText, FileSignature, Ban } from 'lucide-react';
import { api } from '../lib/api';
import type { InvoiceListItem } from '../lib/types';
import { clientName, fmtDate, statusInfo, todayIso, KIND_LABEL } from '../lib/format';
import { Button, Card, Loading, ErrorBox, PageHeader, Segmented, Money, Badge, Empty, cx } from '../components/ui';

type Tab = 'all' | 'invoice' | 'quote' | 'draft' | 'open';

export default function InvoicesPage() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const tab = (sp.get('tab') as Tab) || 'all';
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useQuery<InvoiceListItem[]>({ queryKey: ['invoices'], queryFn: () => api('/invoices') });
  const today = todayIso();

  const list = useMemo(() => {
    let l = data || [];
    if (tab === 'invoice') l = l.filter((i) => i.kind !== 'quote' && i.status !== 'draft');
    if (tab === 'quote') l = l.filter((i) => i.kind === 'quote');
    if (tab === 'draft') l = l.filter((i) => i.status === 'draft');
    if (tab === 'open') l = l.filter((i) => i.kind === 'invoice' && i.status === 'issued');
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      l = l.filter((i) => [i.number, i.title, i.client?.company, i.client?.contact].some((v) => (v || '').toLowerCase().includes(s)));
    }
    return l;
  }, [data, tab, q]);

  const openSum = (data || []).filter((i) => i.kind === 'invoice' && i.status === 'issued').reduce((s, i) => s + i.total_cents, 0);
  const counts = {
    draft: (data || []).filter((i) => i.status === 'draft').length,
    open: (data || []).filter((i) => i.kind === 'invoice' && i.status === 'issued').length,
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title="الفواتير وعروض الأسعار" subtitle={openSum > 0 ? <>بانتظار الدفع: <Money cents={openSum} className="font-semibold text-gray-700" /></> : undefined}
        actions={<Button size="sm" icon={<Plus className="size-4.5" />} onClick={() => nav('/invoices/new')} className="hidden sm:inline-flex">فاتورة جديدة</Button>} />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:hidden">
        <Button icon={<FileText className="size-4.5" />} onClick={() => nav('/invoices/new')}>فاتورة</Button>
        <Button variant="secondary" icon={<FileSignature className="size-4.5" />} onClick={() => nav('/invoices/new?kind=quote')}>عرض سعر</Button>
      </div>

      <Segmented<Tab> className="mb-3" size="sm" value={tab} onChange={(v) => setSp(v === 'all' ? {} : { tab: v }, { replace: true })}
        options={[
          { value: 'all', label: 'الكل' },
          { value: 'invoice', label: 'فواتير' },
          { value: 'quote', label: 'عروض' },
          { value: 'open', label: <>غير مدفوعة{counts.open ? <span className="num ms-1 text-xs text-gray-400">{counts.open}</span> : null}</> },
          { value: 'draft', label: <>مسودات{counts.draft ? <span className="num ms-1 text-xs text-gray-400">{counts.draft}</span> : null}</> },
        ]} />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4.5 text-gray-400" />
        <input className="field !ps-10" placeholder="بحث بالرقم أو العميل…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : list.length === 0 ? (
        <Card><Empty icon={<FileText className="size-6" />} title="ما في شي هون" text="اعمل أول فاتورة بكبسة على الزر." action={<Button onClick={() => nav('/invoices/new')} icon={<Plus className="size-4.5" />}>فاتورة جديدة</Button>} /></Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {list.map((i) => <InvoiceRow key={i.id} inv={i} today={today} />)}
        </Card>
      )}
    </div>
  );
}

export function InvoiceRow({ inv: i, today }: { inv: InvoiceListItem; today: string }) {
  const overdue = i.kind === 'invoice' && i.status === 'issued' && !!i.due_date && i.due_date < today;
  const s = statusInfo(i.kind, i.status, overdue);
  const Icon = i.kind === 'quote' ? FileSignature : i.kind === 'storno' ? Ban : FileText;
  return (
    <Link to={i.status === 'draft' ? `/invoices/${i.id}/edit` : `/invoices/${i.id}`} className="flex items-center gap-3 p-3.5 transition hover:bg-gray-50 active:bg-gray-100">
      <div className={cx('flex size-11 shrink-0 items-center justify-center rounded-xl',
        i.kind === 'quote' ? 'bg-violet-50 text-violet-600' : i.kind === 'storno' ? 'bg-rose-50 text-rose-500' : 'bg-brand-50 text-brand-600')}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-gray-900">{clientName(i.client)}</div>
        <div className="truncate text-xs text-gray-500">
          {i.number ? <span className="num">{i.number}</span> : <span>{KIND_LABEL[i.kind]} (مسودة)</span>} · {fmtDate(i.issue_date)}{i.title ? ` · ${i.title}` : ''}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Money cents={i.total_cents} className={cx('font-bold', i.total_cents < 0 ? 'text-rose-600' : 'text-gray-900')} />
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
    </Link>
  );
}
