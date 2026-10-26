import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, FileText, FileSignature, Repeat2, Mail, Phone, MapPin, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { Client, InvoiceListItem } from '../lib/types';
import { clientName, todayIso } from '../lib/format';
import { Button, Card, Loading, ErrorBox, PageHeader, Money, Section, Empty, useUi, IconButton } from '../components/ui';
import ClientForm from '../components/ClientForm';
import { InvoiceRow } from './Invoices';

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const [edit, setEdit] = useState(false);
  const cQ = useQuery<Client>({ queryKey: ['client', id], queryFn: () => api(`/clients/${id}`) });
  const iQ = useQuery<InvoiceListItem[]>({ queryKey: ['invoices', 'client', id], queryFn: () => api(`/invoices?client_id=${id}`) });

  if (cQ.isLoading) return <Loading />;
  if (cQ.error || !cQ.data) return <><PageHeader back="/clients" title="عميل" /><ErrorBox error={cQ.error} /></>;
  const c = cQ.data;
  const invoices = iQ.data || [];
  const lastInvoice = invoices.find((i) => i.kind === 'invoice' && i.status !== 'draft');

  const repeatLast = async () => {
    if (!lastInvoice) return;
    try {
      const r = await api<{ id: number }>(`/invoices/${lastInvoice.id}/duplicate`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast('نسخة من آخر فاتورة — عدّل اللي بدك ياه وأصدرها');
      nav(`/invoices/${r.id}/edit`);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const archiveToggle = async () => {
    try {
      if (c.archived) {
        await api(`/clients/${c.id}`, { method: 'PUT', body: { archived: false } });
        toast('رجع العميل للنشطين');
      } else {
        if (!(await confirm({ title: invoices.length ? 'أرشفة العميل؟' : 'حذف العميل؟', text: invoices.length ? 'العميل إلو فواتير، فرح ينأرشف بدل ما ينحذف. فواتيرو بتضل محفوظة.' : 'العميل رح ينحذف نهائياً.', confirm: invoices.length ? 'أرشفة' : 'حذف', danger: true }))) return;
        const r = await api<{ archived?: boolean }>(`/clients/${c.id}`, { method: 'DELETE' });
        toast(r.archived ? 'انأرشف العميل' : 'انحذف العميل');
        if (!r.archived) { qc.invalidateQueries({ queryKey: ['clients'] }); return nav('/clients', { replace: true }); }
      }
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client', id] });
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader back="/clients" title={clientName(c)} subtitle={c.company && c.contact ? c.contact : undefined}
        actions={<>
          <IconButton label={c.archived ? 'إرجاع' : 'أرشفة / حذف'} onClick={archiveToggle}>{c.archived ? <ArchiveRestore className="size-5" /> : invoices.length ? <Archive className="size-5" /> : <Trash2 className="size-5" />}</IconButton>
          <IconButton label="تعديل" onClick={() => setEdit(true)}><Pencil className="size-5" /></IconButton>
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Button icon={<FileText className="size-5" />} onClick={() => nav(`/invoices/new?client=${c.id}`)}>فاتورة جديدة</Button>
        <Button variant="secondary" icon={<FileSignature className="size-5" />} onClick={() => nav(`/invoices/new?kind=quote&client=${c.id}`)}>عرض سعر</Button>
        {lastInvoice && <Button variant="soft" className="col-span-2 sm:col-span-1" icon={<Repeat2 className="size-5" />} onClick={repeatLast}>كرّر آخر فاتورة</Button>}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="space-y-2 text-[15px]">
            {(c.street || c.city) && <div className="flex items-start gap-2.5"><MapPin className="mt-0.5 size-4.5 shrink-0 text-gray-400" /><span dir="auto">{[c.street, `${c.zip} ${c.city}`.trim(), c.country].filter(Boolean).join('، ')}</span></div>}
            {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2.5 text-brand-700"><Mail className="size-4.5 shrink-0 text-gray-400" /><span dir="ltr">{c.email}</span></a>}
            {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-2.5 text-brand-700"><Phone className="size-4.5 shrink-0 text-gray-400" /><span dir="ltr">{c.phone}</span></a>}
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-sm text-gray-500">
              <span>رقم العميل: <b className="num text-gray-700">K-{String(c.id).padStart(4, '0')}</b></span>
              {c.vat_id && <span>الرقم الضريبي: <b className="num text-gray-700">{c.vat_id}</b></span>}
              <span>مهلة الدفع: <b className="text-gray-700">{c.payment_days ?? 'افتراضي'}</b>{c.payment_days != null && ' يوم'}</span>
              <span>لغة الفواتير: <b className="text-gray-700">{c.language === 'en' ? 'إنكليزي' : 'ألماني'}</b></span>
            </div>
            {c.notes && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.notes}</p>}
          </div>
        </Card>
        <Card className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-1">
          <div><div className="text-xs text-gray-500">مجموع الفواتير</div><Money cents={c.revenue_cents || 0} className="text-xl font-bold" /></div>
          <div><div className="text-xs text-gray-500">غير مدفوع</div><Money cents={c.open_cents || 0} className={`text-xl font-bold ${(c.open_cents || 0) > 0 ? 'text-amber-700' : ''}`} /></div>
        </Card>
      </div>

      <Section title="الفواتير والعروض">
        {iQ.isLoading ? <Loading /> : invoices.length === 0 ? (
          <Card><Empty icon={<FileText className="size-6" />} title="ما في فواتير لهالعميل لسا" /></Card>
        ) : (
          <Card className="divide-y divide-gray-100">{invoices.map((i) => <InvoiceRow key={i.id} inv={i} today={todayIso()} />)}</Card>
        )}
      </Section>
      <ClientForm open={edit} onClose={() => setEdit(false)} client={c} />
    </div>
  );
}
