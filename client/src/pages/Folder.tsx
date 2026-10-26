import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Receipt, FolderOpen, Camera } from 'lucide-react';
import { api } from '../lib/api';
import type { Folder, MonthData } from '../lib/types';
import { ymLabel, folderLabel, clientName, fmtDayMonth, statusInfo, defaultDateFor } from '../lib/format';
import { Button, Card, Loading, ErrorBox, PageHeader, Empty, Money, Badge, Section } from '../components/ui';
import EntryRow from '../components/EntryRow';
import { useCapture } from '../components/Layout';
import { tr } from '../lib/i18n';

export default function FolderPage() {
  const { ym = '', folder = 'purchase' } = useParams();
  const nav = useNavigate();
  const capture = useCapture();
  const { data, isLoading, error } = useQuery<MonthData>({ queryKey: ['month', ym], queryFn: () => api(`/months/${ym}`) });

  const isInvoices = folder === 'invoices';
  const title = isInvoices ? tr('فواتير العملاء') : folderLabel(folder as Folder);
  const header = <PageHeader back={`/month/${ym}`} title={title} subtitle={ymLabel(ym)} />;
  if (isLoading) return <>{header}<Loading /></>;
  if (error || !data) return <>{header}<ErrorBox error={error} /></>;

  const pickFiles = (f: Folder) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (files.length) capture.openWithFiles(files, { folder: f });
    };
    input.click();
  };

  if (isInvoices) {
    const manual = data.entries.income;
    return (
      <div className="animate-fade-up">
        {header}
        <div className="mb-4 flex gap-2">
          <Button icon={<Plus className="size-5" />} onClick={() => nav('/invoices/new')}>{tr('فاتورة جديدة')}</Button>
          <Button variant="secondary" onClick={() => pickFiles('income')}>{tr('ارفع فاتورة خارجية')}</Button>
        </div>
        {data.invoices.length === 0 && manual.length === 0 ? (
          <Card><Empty icon={<Receipt className="size-6" />} title={tr('ما في فواتير بهالشهر')} text={tr('الفواتير اللي بتصدرها من البرنامج بتنحط هون تلقائياً حسب تاريخها.')} /></Card>
        ) : (
          <>
            {data.invoices.length > 0 && (
              <Section title={tr('صادرة من البرنامج')}>
                <Card className="divide-y divide-gray-100">
                  {data.invoices.map((i) => {
                    const s = statusInfo(i.kind, i.status);
                    return (
                      <Link key={i.id} to={`/invoices/${i.id}`} className="flex items-center gap-3 p-3.5 transition hover:bg-gray-50">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-gray-900">{clientName(i.client)}</div>
                          <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="num">{i.number}</span> · {fmtDayMonth(i.issue_date)}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Money cents={i.total_cents} className="font-bold text-gray-900" />
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </div>
                      </Link>
                    );
                  })}
                </Card>
              </Section>
            )}
            {manual.length > 0 && (
              <Section title={tr('فواتير خارجية (إدخال يدوي)')}>
                <Card className="divide-y divide-gray-100">{manual.map((e) => <EntryRow key={e.id} entry={e} income />)}</Card>
              </Section>
            )}
          </>
        )}
      </div>
    );
  }

  const list = data.entries[folder as Folder] || [];
  return (
    <div className="animate-fade-up">
      {header}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button icon={<Camera className="size-5" />} onClick={() => document.getElementById('gt-cam-folder')?.click()}>{tr('صوّر')}</Button>
        <Button variant="secondary" onClick={() => pickFiles(folder as Folder)}>{tr('ارفع ملف')}</Button>
        <Button variant="ghost" onClick={() => nav(`/entry/new?folder=${folder}&date=${defaultDateFor(ym)}`)}>{tr('بدون ملف')}</Button>
        <input id="gt-cam-folder" type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) capture.openWithFiles(f, { folder }); }} />
      </div>
      {list.length === 0 ? (
        <Card><Empty icon={<FolderOpen className="size-6" />} title={tr('المجلد فاضي')} text={tr('ارفع أول إيصال لهالشهر.')} /></Card>
      ) : (
        <Card className="divide-y divide-gray-100">{list.map((e) => <EntryRow key={e.id} entry={e} />)}</Card>
      )}
    </div>
  );
}
