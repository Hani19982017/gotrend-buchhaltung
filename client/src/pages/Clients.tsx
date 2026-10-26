import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus, Users, MapPin, Archive } from 'lucide-react';
import { api } from '../lib/api';
import type { Client } from '../lib/types';
import { clientName } from '../lib/format';
import { Button, Card, Loading, ErrorBox, PageHeader, Empty, Money, Segmented } from '../components/ui';
import ClientForm from '../components/ClientForm';

export default function ClientsPage() {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState<'0' | '1'>('0');
  const [formOpen, setFormOpen] = useState(false);
  const { data, isLoading, error } = useQuery<Client[]>({ queryKey: ['clients', archived], queryFn: () => api(`/clients?archived=${archived}`) });

  const list = useMemo(() => (data || []).filter((c) => !q.trim() || [c.company, c.contact, c.city, c.email].some((v) => (v || '').toLowerCase().includes(q.trim().toLowerCase()))), [data, q]);

  return (
    <div className="animate-fade-up">
      <PageHeader title="العملاء" subtitle={data ? <><span className="num">{data.length}</span> {archived === '1' ? 'مؤرشف' : 'عميل'}</> : undefined}
        actions={<Button size="sm" icon={<UserPlus className="size-4.5" />} onClick={() => setFormOpen(true)}>عميل جديد</Button>} />
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4.5 text-gray-400" />
          <input className="field !ps-10" placeholder="بحث بالاسم أو المدينة…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented size="sm" className="shrink-0" value={archived} onChange={setArchived} options={[{ value: '0', label: 'نشط' }, { value: '1', label: <Archive className="size-4" /> }]} />
      </div>
      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : list.length === 0 ? (
        <Card><Empty icon={<Users className="size-6" />} title={q ? 'ما لقيت شي' : 'لسا ما في عملاء'} text="ضيف عملاءك الثابتين مرة وحدة، وبعدين بتختارهم بكبسة بالفاتورة." action={!q && <Button onClick={() => setFormOpen(true)} icon={<UserPlus className="size-4.5" />}>أضف أول عميل</Button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <Link key={c.id} to={`/clients/${c.id}`} className="group card card-hover p-4">
              <div className="flex items-start gap-3">
                <div className="icon-pop flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-md">
                  {clientName(c).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-gray-900">{clientName(c)}</div>
                  {c.company && c.contact && <div className="truncate text-sm text-gray-500">{c.contact}</div>}
                  {c.city && <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-400"><MapPin className="size-3" />{c.city}</div>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-gray-50 px-2.5 py-2"><div className="text-gray-500">مجموع الفواتير</div><Money cents={c.revenue_cents || 0} className="font-bold text-gray-800" /></div>
                <div className="rounded-xl bg-gray-50 px-2.5 py-2"><div className="text-gray-500">غير مدفوع</div><Money cents={c.open_cents || 0} className={(c.open_cents || 0) > 0 ? 'font-bold text-amber-700' : 'font-bold text-gray-800'} /></div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <ClientForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
