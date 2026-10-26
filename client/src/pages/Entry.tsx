import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Paperclip, Trash2, FileText, X, ExternalLink, Download, Save, CalendarDays, Check } from 'lucide-react';
import { api, downloadFrom } from '../lib/api';
import type { Entry, Folder, PaymentMethod, Subscription } from '../lib/types';
import { FOLDERS, METHODS, centsToInput, parseAmount, todayIso, ymLabel, folderLabel, fileSize } from '../lib/format';
import { prepareUpload } from '../lib/image';
import { captureStore } from '../lib/captureStore';
import { Button, Card, Field, Loading, ErrorBox, PageHeader, Chips, useUi, IconButton } from '../components/ui';

type Draft = {
  folder: Folder;
  date: string;
  vendor: string;
  amount: string;
  payment_method: PaymentMethod;
  description: string;
  notes: string;
  subscription_id: string;
};

export default function EntryPage() {
  const { id } = useParams();
  const isNew = !id;
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();

  const entryQ = useQuery<Entry>({ queryKey: ['entry', id], queryFn: () => api(`/entries/${id}`), enabled: !isNew });
  const subsQ = useQuery<Subscription[]>({ queryKey: ['subscriptions'], queryFn: () => api('/subscriptions') });
  const vendorsQ = useQuery<{ vendor: string; folder: Folder; payment_method: PaymentMethod }[]>({ queryKey: ['vendors'], queryFn: () => api('/vendors'), staleTime: 60_000 });

  const [d, setD] = useState<Draft>(() => ({
    folder: (FOLDERS.some((f) => f.key === sp.get('folder')) ? sp.get('folder') : 'purchase') as Folder,
    date: sp.get('date') || todayIso(),
    vendor: sp.get('vendor') || '',
    amount: sp.get('amount') ? centsToInput(Number(sp.get('amount'))) : '',
    payment_method: (sp.get('method') as PaymentMethod) || 'card',
    description: sp.get('desc') || '',
    notes: '',
    subscription_id: sp.get('sub') || '',
  }));
  const [newFiles, setNewFiles] = useState<File[]>(() => captureStore.peek());
  const [saving, setSaving] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const loadedRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => captureStore.clear(), []);
  useEffect(() => {
    if (isNew && d.folder !== 'bank') setTimeout(() => amountRef.current?.focus(), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (entryQ.data && !loadedRef.current) {
      loadedRef.current = true;
      const e = entryQ.data;
      setD({ folder: e.folder, date: e.date, vendor: e.vendor, amount: centsToInput(e.amount_cents), payment_method: e.payment_method, description: e.description, notes: e.notes, subscription_id: e.subscription_id ? String(e.subscription_id) : '' });
      if (e.notes || e.description) setShowMore(true);
    }
  }, [entryQ.data]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const previews = useMemo(() => newFiles.map((f) => ({ f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })), [newFiles]);
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews]);

  const subs = (subsQ.data || []).filter((s) => s.active);
  const ym = d.date.slice(0, 7);

  const onVendor = (v: string) => {
    set('vendor', v);
    const known = vendorsQ.data?.find((x) => x.vendor.toLowerCase() === v.trim().toLowerCase());
    if (known && isNew) setD((p) => ({ ...p, vendor: v, folder: p.folder === 'bank' ? p.folder : known.folder === 'bank' ? p.folder : known.folder, payment_method: known.payment_method }));
  };
  const onSub = (sid: string) => {
    const s = subs.find((x) => String(x.id) === sid);
    setD((p) => ({ ...p, subscription_id: sid, ...(s ? { vendor: p.vendor || s.vendor || s.name, amount: p.amount || centsToInput(s.amount_cents), payment_method: s.payment_method, description: p.description || s.name } : {}) }));
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    if (isNew) {
      setNewFiles((p) => [...p, ...files]);
      return;
    }
    // existing entry → upload immediately
    setSaving(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', await prepareUpload(f));
      const r = await api<{ entry: Entry; duplicates: unknown[] }>(`/entries/${id}/files`, { form: fd });
      qc.setQueryData(['entry', id], r.entry);
      qc.invalidateQueries({ queryKey: ['month'] });
      toast(r.duplicates.length ? 'انضاف — بس انتبه، هالملف مرفوع قبل بمكان تاني' : 'انضاف الملف', r.duplicates.length ? 'info' : 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const pick = (camera: boolean) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = camera ? 'image/*' : 'image/*,application/pdf';
    if (camera) input.setAttribute('capture', 'environment');
    input.multiple = !camera;
    input.onchange = () => addFiles(Array.from(input.files || []));
    input.click();
  };

  const validate = () => {
    if (!d.date) return 'اختار التاريخ';
    if (d.folder !== 'bank') {
      const a = parseAmount(d.amount);
      if (a === null || a <= 0) return 'اكتب المبلغ';
    }
    if (d.folder !== 'bank' && !d.vendor.trim()) return d.folder === 'income' ? 'اكتب اسم العميل' : 'اكتب من وين اشتريت (المتجر أو الشركة)';
    if (d.folder === 'bank' && isNew && !newFiles.length) return 'ارفع ملف كشف الحساب';
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) return toast(err, 'error');
    setSaving(true);
    try {
      const amount = parseAmount(d.amount) ?? 0;
      if (isNew) {
        const fd = new FormData();
        fd.append('folder', d.folder);
        fd.append('date', d.date);
        fd.append('vendor', d.vendor.trim());
        fd.append('amount', String(amount));
        fd.append('payment_method', d.payment_method);
        fd.append('description', d.description);
        fd.append('notes', d.notes);
        if (d.subscription_id && ['subscription', 'other'].includes(d.folder)) fd.append('subscription_id', d.subscription_id);
        for (const f of newFiles) fd.append('files', await prepareUpload(f));
        const r = await api<{ entry: Entry; duplicates: unknown[] }>('/entries', { form: fd });
        captureStore.clear();
        qc.invalidateQueries({ queryKey: ['month'] });
        qc.invalidateQueries({ queryKey: ['vendors'] });
        if (r.duplicates.length) toast('انحفظ — بس انتبه، هالملف مرفوع قبل. تأكد إنو مو مكرر', 'info');
        else toast(`انحفظ بـ ${folderShort(d.folder)} · ${ymLabel(ym)}`);
        nav(`/month/${ym}`, { replace: true });
      } else {
        await api(`/entries/${id}`, { method: 'PUT', body: { ...d, vendor: d.vendor.trim(), amount, subscription_id: ['subscription', 'other'].includes(d.folder) && d.subscription_id ? d.subscription_id : null } });
        qc.invalidateQueries({ queryKey: ['month'] });
        qc.invalidateQueries({ queryKey: ['entry', id] });
        toast('انحفظت التعديلات');
        nav(-1);
      }
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'حذف الإيصال؟', text: 'بيروح على سلة المحذوفات، وفيك ترجّعو من الإعدادات.', confirm: 'حذف', danger: true }))) return;
    try {
      await api(`/entries/${id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['month'] });
      toast('انحذف (موجود بسلة المحذوفات)');
      nav(-1);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const removeFile = async (fileId: number) => {
    if (!(await confirm({ title: 'حذف هالملف؟', text: 'الملف رح ينحذف نهائياً من هالإيصال.', confirm: 'حذف', danger: true }))) return;
    try {
      const e = await api<Entry>(`/entries/${id}/files/${fileId}`, { method: 'DELETE' });
      qc.setQueryData(['entry', id], e);
      qc.invalidateQueries({ queryKey: ['month'] });
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  if (!isNew && entryQ.isLoading) return <Loading />;
  if (!isNew && entryQ.error) return <><PageHeader back title="إيصال" /><ErrorBox error={entryQ.error} /></>;
  const existingFiles = entryQ.data?.files || [];
  const isIncome = d.folder === 'income';
  const isBank = d.folder === 'bank';

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <PageHeader back title={isNew ? 'إيصال جديد' : 'تفاصيل الإيصال'}
        actions={!isNew && <IconButton label="حذف" onClick={remove} className="text-red-600 hover:bg-red-50"><Trash2 className="size-5" /></IconButton>} />

      {/* Files */}
      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-700">{isBank ? 'ملف كشف الحساب' : 'الإيصال / الفاتورة'}</span>
          <span className="text-xs text-gray-400">صور أو PDF</span>
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
          {existingFiles.map((f) => (
            <div key={f.id} className="relative shrink-0">
              <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block">
                {f.mime.startsWith('image/') && !f.mime.includes('hei') ? (
                  <img src={`/api/files/${f.id}`} alt={f.original_name} className="h-36 w-28 rounded-2xl object-cover ring-1 ring-gray-200" />
                ) : (
                  <div className="flex h-36 w-28 flex-col items-center justify-center gap-1 rounded-2xl bg-red-50 p-2 text-center text-red-600 ring-1 ring-red-100">
                    <FileText className="size-7" />
                    <span className="line-clamp-2 text-[11px] font-semibold" dir="ltr">{f.original_name}</span>
                    <span className="text-[10px] text-red-400">{fileSize(f.size)}</span>
                  </div>
                )}
              </a>
              <div className="absolute inset-x-1 bottom-1 flex justify-between">
                <button aria-label="تحميل" onClick={() => downloadFrom(`/files/${f.id}?download=1`, f.original_name)} className="flex size-7 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow"><Download className="size-3.5" /></button>
                <button aria-label="حذف الملف" onClick={() => removeFile(f.id)} className="flex size-7 items-center justify-center rounded-full bg-white/90 text-red-600 shadow"><X className="size-3.5" /></button>
              </div>
            </div>
          ))}
          {previews.map((p, i) => (
            <div key={i} className="relative shrink-0">
              {p.url ? (
                <img src={p.url} alt="" className="h-36 w-28 rounded-2xl object-cover ring-1 ring-gray-200" />
              ) : (
                <div className="flex h-36 w-28 flex-col items-center justify-center gap-1 rounded-2xl bg-red-50 p-2 text-center text-red-600 ring-1 ring-red-100">
                  <FileText className="size-7" />
                  <span className="line-clamp-2 text-[11px] font-semibold" dir="ltr">{p.f.name}</span>
                </div>
              )}
              <button aria-label="شيل" onClick={() => setNewFiles((x) => x.filter((_, j) => j !== i))} className="absolute top-1.5 end-1.5 flex size-7 items-center justify-center rounded-full bg-gray-900/70 text-white"><X className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => pick(true)} className="group flex h-36 w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 text-brand-700 transition hover:bg-brand-50 active:scale-95">
            <Camera className="icon-pop size-7" />
            <span className="text-xs font-bold">{existingFiles.length + newFiles.length ? 'صفحة كمان' : 'صوّر'}</span>
          </button>
          <button type="button" onClick={() => pick(false)} className="group flex h-36 w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-gray-200 text-gray-600 transition hover:bg-gray-50 active:scale-95">
            <Paperclip className="icon-pop size-7" />
            <span className="text-xs font-bold">ملف / PDF</span>
          </button>
        </div>
      </Card>

      {/* Fields */}
      <Card className="space-y-4 p-4">
        <Field label="المجلد" group>
          <Chips value={d.folder} onChange={(v) => set('folder', v)} options={FOLDERS.map((f) => ({ value: f.key, label: f.short }))} />
        </Field>

        {!isBank && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={isIncome ? 'المبلغ المستلم' : 'المبلغ (شامل الضريبة)'}>
              <div className="relative">
                <input ref={amountRef} className="field num !pr-10 text-left text-2xl font-bold" inputMode="decimal" placeholder="0,00" value={d.amount}
                  onChange={(e) => set('amount', e.target.value)} dir="ltr" />
                <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-lg font-bold text-gray-400">€</span>
              </div>
            </Field>
            <Field label={isIncome ? 'العميل' : 'من وين؟ (المتجر / الشركة)'}>
              <input className="field" list="gt-vendors" value={d.vendor} onChange={(e) => onVendor(e.target.value)} placeholder={isIncome ? 'اسم العميل' : 'مثلاً: Amazon, MediaMarkt'} autoComplete="off" />
              <datalist id="gt-vendors">{(vendorsQ.data || []).map((v) => <option key={v.vendor} value={v.vendor} />)}</datalist>
            </Field>
          </div>
        )}

        <Field label="التاريخ" hint={<span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" /> رح ينحفظ بـ <b className="text-gray-700">{ymLabel(ym)}</b> ← {folderLabel(d.folder)}</span>}>
          <input type="date" className="field" value={d.date} onChange={(e) => set('date', e.target.value)} required />
        </Field>

        {!isBank && (
          <Field label={isIncome ? 'طريقة الاستلام' : 'طريقة الدفع'} group>
            <Chips value={d.payment_method} onChange={(v) => set('payment_method', v)} options={METHODS.map((m) => ({ value: m.key, label: m.label }))} />
          </Field>
        )}

        {['subscription', 'other'].includes(d.folder) && subs.length > 0 && (
          <Field label="تابع لاشتراك ثابت؟" hint="بيعلّم الاشتراك كمكتمل بقائمة الشهر">
            <select className="field" value={d.subscription_id} onChange={(e) => onSub(e.target.value)}>
              <option value="">لا</option>
              {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}

        {!showMore ? (
          <button type="button" onClick={() => setShowMore(true)} className="text-sm font-semibold text-brand-600">+ وصف أو ملاحظة</button>
        ) : (
          <>
            <Field label="الوصف" hint="شو اشتريت؟ بيساعد المحاسب">
              <input className="field" value={d.description} onChange={(e) => set('description', e.target.value)} placeholder="مثلاً: شاشة للمكتب" />
            </Field>
            <Field label="ملاحظة داخلية">
              <textarea className="field" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </>
        )}
      </Card>

      <div className="safe-bottom sticky bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 mt-4 lg:bottom-4">
        <Button size="lg" block loading={saving} onClick={save} icon={isNew ? <Check className="size-5" /> : <Save className="size-5" />} className="h-14 text-[17px] shadow-xl">
          {isNew ? 'حفظ' : 'حفظ التعديلات'}
        </Button>
      </div>
      {!isNew && entryQ.data && (
        <p className="mt-3 text-center text-xs text-gray-400">
          أُضيف {entryQ.data.created_at.slice(0, 10).split('-').reverse().join('.')}
          {existingFiles.length > 0 && <> · <a className="inline-flex items-center gap-0.5" href={`/api/files/${existingFiles[0].id}`} target="_blank" rel="noreferrer">فتح الملف <ExternalLink className="size-3" /></a></>}
        </p>
      )}
    </div>
  );
}

function folderShort(f: Folder) {
  return FOLDERS.find((x) => x.key === f)?.label || f;
}
