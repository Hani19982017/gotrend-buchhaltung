import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Share2, CheckCircle2, Undo2, PencilLine, Ban, Copy, FileCheck2, ThumbsUp, ThumbsDown, Mail, ArrowLeftRight } from 'lucide-react';
import { api, apiBlob, downloadFrom, shareBlob } from '../lib/api';
import type { Invoice } from '../lib/types';
import { clientName, fmtDate, statusInfo, todayIso, KIND_LABEL } from '../lib/format';
import { Button, Card, Loading, ErrorBox, PageHeader, Badge, Money, useUi, Sheet, Field } from '../components/ui';
import PdfPreview from '../components/PdfPreview';

export default function InvoiceView() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const { data: inv, isLoading, error, isFetching } = useQuery<Invoice>({ queryKey: ['invoice', id], queryFn: () => api(`/invoices/${id}`) });
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paidOpen, setPaidOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(todayIso());

  useEffect(() => {
    if (!inv) return;
    if (inv.status === 'draft') { if (!isFetching) nav(`/invoices/${inv.id}/edit`, { replace: true }); return; }
    let alive = true;
    apiBlob(`/invoices/${inv.id}/pdf`).then((b) => alive && setPdf(b)).catch(() => null);
    return () => { alive = false; };
  }, [inv?.id, inv?.status, inv?.pdf_file, isFetching]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <Loading />;
  if (error || !inv) return <><PageHeader back="/invoices" title="فاتورة" /><ErrorBox error={error} /></>;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['invoice', id] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['month'] });
    qc.invalidateQueries({ queryKey: ['clients'] });
  };
  const act = async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (msg) toast(msg);
      refresh();
      return r;
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const overdue = inv.kind === 'invoice' && inv.status === 'issued' && !!inv.due_date && inv.due_date < todayIso();
  const st = statusInfo(inv.kind, inv.status, overdue);
  const fileName = `${inv.number}_${clientName(inv.client).replace(/[^\w\-.]+/g, '_')}.pdf`;
  const docLabel = KIND_LABEL[inv.kind];

  const download = () => act('dl', () => downloadFrom(`/invoices/${inv.id}/pdf?download=1`, fileName));
  const share = () => act('share', async () => {
    const blob = pdf || (await apiBlob(`/invoices/${inv.id}/pdf`));
    await shareBlob(blob, fileName, `${docLabel} ${inv.number}`);
  });
  const mail = () => {
    const isEn = inv.language === 'en';
    const subject = isEn ? `${inv.kind === 'quote' ? 'Quotation' : 'Invoice'} ${inv.number}` : `${inv.kind === 'quote' ? 'Angebot' : 'Rechnung'} ${inv.number}`;
    const greet = inv.client?.contact ? (isEn ? `Dear ${inv.client.contact},` : `Guten Tag ${inv.client.contact},`) : isEn ? 'Dear Sir or Madam,' : 'Sehr geehrte Damen und Herren,';
    const bodyTxt = isEn
      ? `${greet}\n\nplease find attached our ${inv.kind === 'quote' ? 'quotation' : 'invoice'} ${inv.number}.\n\nKind regards`
      : `${greet}\n\nanbei erhalten Sie ${inv.kind === 'quote' ? 'unser Angebot' : 'unsere Rechnung'} ${inv.number}.\n\nMit freundlichen Grüßen`;
    download();
    window.location.href = `mailto:${inv.client?.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyTxt)}`;
  };

  const markPaid = () => act('paid', () => api(`/invoices/${inv.id}/paid`, { body: { date: paidDate } }), 'تمام، الفاتورة مدفوعة').then(() => setPaidOpen(false));
  const markUnpaid = () => act('unpaid', () => api(`/invoices/${inv.id}/paid`, { body: { paid: false } }), 'رجعت غير مدفوعة');

  const cancel = async () => {
    const reason = await confirm({
      title: 'إلغاء الفاتورة',
      text: <>رح تنعمل <b>فاتورة إلغاء</b> برقم جديد بتلغي هالفاتورة بالكامل. الفاتورة الأصلية بتضل محفوظة متل ما هي (هيك بيطلب القانون).</>,
      input: { label: 'سبب الإلغاء', placeholder: 'مثلاً: الطلب انلغى', required: true },
      confirm: 'إلغاء الفاتورة', danger: true,
    });
    if (!reason) return;
    const r: any = await act('cancel', () => api(`/invoices/${inv.id}/cancel`, { body: { reason } }), 'انعملت فاتورة الإلغاء');
    if (r?.stornoId) nav(`/invoices/${r.stornoId}`);
  };
  const correct = async () => {
    const reason = await confirm({
      title: 'تصحيح الفاتورة',
      text: <>الطريقة القانونية للتعديل: البرنامج بيعمل <b>فاتورة إلغاء</b> للقديمة، وبيفتحلك <b>نسخة جديدة</b> فيك تعدّلها وتصدرها برقم جديد.</>,
      input: { label: 'شو بدك تصحح؟', placeholder: 'مثلاً: السعر غلط', required: false },
      confirm: 'تصحيح',
    });
    if (!reason) return;
    const r: any = await act('correct', () => api(`/invoices/${inv.id}/correct`, { body: { reason: reason === 'ok' ? '' : reason } }));
    if (r?.newId) nav(`/invoices/${r.newId}/edit`);
  };
  const duplicate = async () => {
    const r: any = await act('dup', () => api(`/invoices/${inv.id}/duplicate`, { method: 'POST' }), 'انعملت نسخة جديدة');
    if (r?.id) nav(`/invoices/${r.id}/edit`);
  };
  const convert = async () => {
    const r: any = await act('convert', () => api(`/invoices/${inv.id}/convert`, { method: 'POST' }), 'تحوّل لفاتورة (مسودة)');
    if (r?.id) nav(`/invoices/${r.id}/edit`);
  };
  const quoteStatus = (status: string) => act('qs', () => api(`/invoices/${inv.id}/quote-status`, { body: { status } }), 'انحفظت الحالة');

  return (
    <div className="animate-fade-up">
      <PageHeader back="/invoices" title={<span className="num">{inv.number}</span>} subtitle={<>{docLabel} · {clientName(inv.client)}</>} />

      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="order-2 lg:order-1">
          <div className="rounded-2xl bg-gray-100 p-2 sm:p-3"><PdfPreview blob={pdf} /></div>
        </div>

        <div className="order-1 mb-5 space-y-4 lg:order-2 lg:mb-0">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Badge tone={st.tone} className="!text-sm">{st.label}</Badge>
              <Money cents={inv.total_cents} className="text-2xl font-bold" />
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">التاريخ</dt><dd className="num">{fmtDate(inv.issue_date)}</dd></div>
              {inv.due_date && inv.kind !== 'storno' && <div className="flex justify-between"><dt className="text-gray-500">{inv.kind === 'quote' ? 'صالح لغاية' : 'الاستحقاق'}</dt><dd className={overdue ? 'num font-semibold text-amber-700' : 'num'}>{fmtDate(inv.due_date)}</dd></div>}
              {inv.paid_date && <div className="flex justify-between"><dt className="text-gray-500">تاريخ الدفع</dt><dd className="num text-emerald-700">{fmtDate(inv.paid_date)}</dd></div>}
              {inv.cancel_reason && <div className="flex justify-between gap-3"><dt className="shrink-0 text-gray-500">سبب الإلغاء</dt><dd className="text-end">{inv.cancel_reason}</dd></div>}
            </dl>
            {(inv.related || inv.cancelledBy || inv.convertedTo) && (
              <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3 text-sm">
                {inv.related && <Link className="flex items-center gap-1.5 font-semibold text-brand-600" to={`/invoices/${inv.related.id}`}><ArrowLeftRight className="size-4" />{inv.kind === 'storno' ? 'بتلغي الفاتورة' : inv.related.kind === 'quote' ? 'من عرض السعر' : 'تصحيح لـ'} <span className="num">{inv.related.number}</span></Link>}
                {inv.cancelledBy && <Link className="flex items-center gap-1.5 font-semibold text-rose-600" to={`/invoices/${inv.cancelledBy.id}`}><Ban className="size-4" />انلغت بـ <span className="num">{inv.cancelledBy.number}</span></Link>}
                {inv.convertedTo && <Link className="flex items-center gap-1.5 font-semibold text-emerald-700" to={inv.convertedTo.number ? `/invoices/${inv.convertedTo.id}` : `/invoices/${inv.convertedTo.id}/edit`}><FileCheck2 className="size-4" />الفاتورة: {inv.convertedTo.number ? <span className="num">{inv.convertedTo.number}</span> : 'مسودة'}</Link>}
              </div>
            )}
          </Card>

          {/* Primary actions */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={<Download className="size-5" />} loading={busy === 'dl'} onClick={download}>تحميل PDF</Button>
            <Button variant="secondary" icon={<Share2 className="size-5" />} loading={busy === 'share'} onClick={share}>مشاركة</Button>
            {inv.kind !== 'storno' && <Button variant="secondary" className="col-span-2" icon={<Mail className="size-5" />} onClick={mail}>إيميل للعميل</Button>}
          </div>

          {inv.kind === 'invoice' && inv.status === 'issued' && (
            <Button variant="success" block size="lg" icon={<CheckCircle2 className="size-5" />} onClick={() => { setPaidDate(todayIso()); setPaidOpen(true); }}>تم الدفع</Button>
          )}
          {inv.kind === 'quote' && !inv.convertedTo && inv.status !== 'declined' && (
            <Button variant="success" block size="lg" icon={<FileCheck2 className="size-5" />} loading={busy === 'convert'} onClick={convert}>حوّل لفاتورة</Button>
          )}

          <Card className="divide-y divide-gray-100">
            {inv.kind === 'invoice' && inv.status === 'paid' && <ActionRow icon={<Undo2 className="size-5" />} label="رجّعها غير مدفوعة" onClick={markUnpaid} />}
            {inv.kind === 'invoice' && ['issued', 'paid'].includes(inv.status) && <ActionRow icon={<PencilLine className="size-5" />} label="تصحيح الفاتورة" sub="إلغاء + نسخة جديدة للتعديل" onClick={correct} />}
            {inv.kind === 'invoice' && ['issued', 'paid'].includes(inv.status) && <ActionRow icon={<Ban className="size-5" />} label="إلغاء الفاتورة" sub="بفاتورة إلغاء رسمية" danger onClick={cancel} />}
            {inv.kind === 'quote' && inv.status !== 'accepted' && <ActionRow icon={<ThumbsUp className="size-5" />} label="العميل وافق" onClick={() => quoteStatus('accepted')} />}
            {inv.kind === 'quote' && inv.status !== 'declined' && !inv.convertedTo && <ActionRow icon={<ThumbsDown className="size-5" />} label="العميل رفض" onClick={() => quoteStatus('declined')} />}
            {inv.kind !== 'storno' && <ActionRow icon={<Copy className="size-5" />} label="نسخة جديدة" sub="نفس البنود لعميل أو شهر تاني" onClick={duplicate} />}
          </Card>
        </div>
      </div>

      <Sheet open={paidOpen} onClose={() => setPaidOpen(false)} title="تم الدفع"
        footer={<Button variant="success" block size="lg" loading={busy === 'paid'} onClick={markPaid}>تأكيد</Button>}>
        <Field label="تاريخ وصول المبلغ"><input type="date" className="field" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
      </Sheet>
    </div>
  );
}

function ActionRow({ icon, label, sub, onClick, danger }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`group flex w-full items-center gap-3 px-4 py-3.5 text-start transition hover:bg-gray-50 ${danger ? 'text-red-600' : 'text-gray-800'}`}>
      <span className="icon-pop">{icon}</span>
      <span className="flex-1">
        <span className="block font-semibold">{label}</span>
        {sub && <span className="block text-xs text-gray-500">{sub}</span>}
      </span>
    </button>
  );
}
