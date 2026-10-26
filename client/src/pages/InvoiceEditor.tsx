import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ChevronUp, ChevronDown, Eye, Save, Send, UserPlus, Search, Building2, Check, CalendarRange } from 'lucide-react';
import { api, apiBlob } from '../lib/api';
import type { Client, Invoice, InvoiceKind, Settings } from '../lib/types';
import { parseAmount, todayIso, fmtEur, clientName, ymRange, shiftYm, KIND_LABEL } from '../lib/format';
import { Rich, Button, Card, Field, Loading, ErrorBox, PageHeader, Segmented, Sheet, useUi, IconButton, cx, Money } from '../components/ui';
import PdfPreview from '../components/PdfPreview';
import ClientForm from '../components/ClientForm';
import { tr } from '../lib/i18n';

type Item = { id: string; description: string; qty: string; unit: string; price: string; tax_rate: number };
type Form = {
  kind: InvoiceKind;
  client_id: number | null;
  issue_date: string;
  service_from: string;
  service_to: string;
  due_date: string;
  language: 'de' | 'en';
  title: string;
  items: Item[];
  intro_text: string;
  outro_text: string;
  internal_note: string;
  tax_treatment: 'auto' | 'reverse_charge' | 'export';
};

const uid = () => Math.random().toString(36).slice(2, 9);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const numStr = (n: number) => String(n).replace('.', ',');

function defaultTexts(s: Settings, kind: InvoiceKind, lang: 'de' | 'en') {
  const L = lang === 'en' ? 'En' : 'De';
  const i = s.invoice as any;
  return kind === 'quote' ? { intro: i[`quoteIntro${L}`], outro: i[`quoteOutro${L}`] } : { intro: i[`intro${L}`], outro: i[`outro${L}`] };
}

export default function InvoiceEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const isNew = !id;

  const settingsQ = useQuery<Settings>({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const clientsQ = useQuery<Client[]>({ queryKey: ['clients'], queryFn: () => api('/clients') });
  const invQ = useQuery<Invoice>({ queryKey: ['invoice', id], queryFn: () => api(`/invoices/${id}`), enabled: !isNew });

  const [f, setF] = useState<Form | null>(null);
  const [dueTouched, setDueTouched] = useState(false);
  const [textsTouched, setTextsTouched] = useState(false);
  const [clientPicker, setClientPicker] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState<false | 'save' | 'issue'>(false);
  const [dirty, setDirty] = useState(false);
  const createdId = useRef<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const h = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  // Initialise form
  useEffect(() => {
    if (f || !settingsQ.data) return;
    const s = settingsQ.data;
    if (isNew) {
      if (!clientsQ.data) return;
      const kind = (sp.get('kind') === 'quote' ? 'quote' : 'invoice') as InvoiceKind;
      const preClient = clientsQ.data.find((c) => String(c.id) === sp.get('client')) || null;
      const lang = preClient?.language || s.invoice.defaultLanguage;
      const t = defaultTexts(s, kind, lang);
      const issue = todayIso();
      const days = kind === 'quote' ? s.invoice.quoteValidDays : preClient?.payment_days ?? s.invoice.paymentDays;
      setF({
        kind, client_id: preClient?.id ?? null, issue_date: issue, service_from: '', service_to: '', due_date: addDays(issue, days), language: lang,
        title: '', items: [{ id: uid(), description: '', qty: '1', unit: s.units[0] || 'Stk.', price: '', tax_rate: s.tax.defaultRate }],
        intro_text: t.intro, outro_text: t.outro, internal_note: '', tax_treatment: 'auto',
      });
    } else if (invQ.data) {
      const i = invQ.data;
      if (i.status !== 'draft') {
        nav(`/invoices/${i.id}`, { replace: true });
        return;
      }
      setDueTouched(true);
      setTextsTouched(true);
      setF({
        kind: i.kind, client_id: i.client_id, issue_date: i.issue_date, service_from: i.service_from || '', service_to: i.service_to || '', due_date: i.due_date || '',
        language: i.language, title: i.title,
        items: i.items.length ? i.items.map((it) => ({ id: it.id || uid(), description: it.description, qty: numStr(it.qty), unit: it.unit, price: (it.price_cents / 100).toFixed(2).replace('.', ','), tax_rate: it.tax_rate })) : [{ id: uid(), description: '', qty: '1', unit: s.units[0] || 'Stk.', price: '', tax_rate: s.tax.defaultRate }],
        intro_text: i.intro_text, outro_text: i.outro_text, internal_note: i.internal_note, tax_treatment: i.tax_treatment,
      });
    }
  }, [f, settingsQ.data, clientsQ.data, invQ.data, isNew, sp, nav]);

  const s = settingsQ.data;
  const client = useMemo(() => clientsQ.data?.find((c) => c.id === f?.client_id) || null, [clientsQ.data, f?.client_id]);
  const standard = s?.tax.mode === 'standard';

  const update = useCallback((patch: Partial<Form>) => {
    setF((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  }, []);

  // Auto due date
  useEffect(() => {
    if (!f || !s || dueTouched || !f.issue_date) return;
    const days = f.kind === 'quote' ? s.invoice.quoteValidDays : client?.payment_days ?? s.invoice.paymentDays;
    const due = addDays(f.issue_date, days);
    if (due !== f.due_date) setF((p) => (p ? { ...p, due_date: due } : p));
  }, [f?.issue_date, f?.kind, client, s, dueTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    if (!f) return { net: 0, tax: 0, total: 0, lines: [] as { rate: number; base: number; tax: number }[] };
    const rows = f.items.map((it) => {
      const q = parseAmount(it.qty) ?? 0;
      const p = Math.round((parseAmount(it.price) ?? 0) * 100);
      return { total: Math.round(q * p), rate: standard ? it.tax_rate : 0 };
    });
    const net = rows.reduce((a, r) => a + r.total, 0);
    const groups: Record<number, number> = {};
    if (standard && f.tax_treatment === 'auto') rows.forEach((r) => { if (r.rate) groups[r.rate] = (groups[r.rate] || 0) + r.total; });
    const lines = Object.keys(groups).map(Number).sort((a, b) => b - a).map((rate) => ({ rate, base: groups[rate], tax: Math.round((groups[rate] * rate) / 100) }));
    const tax = lines.reduce((a, l) => a + l.tax, 0);
    return { net, tax, total: net + tax, lines };
  }, [f, standard]);

  const body = useMemo(() => {
    if (!f) return null;
    return {
      ...f,
      service_from: f.service_from || null,
      service_to: f.service_to || null,
      items: f.items.map((it) => ({ id: it.id, description: it.description, qty: parseAmount(it.qty) ?? 0, unit: it.unit, price: parseAmount(it.price) ?? 0, tax_rate: it.tax_rate })),
    };
  }, [f]);

  // Live preview (debounced)
  const reqRef = useRef<AbortController | null>(null);
  const wantPreview = isDesktop || previewOpen;
  useEffect(() => {
    if (!body || !wantPreview) return;
    const t = setTimeout(async () => {
      reqRef.current?.abort();
      const ac = new AbortController();
      reqRef.current = ac;
      setPreviewLoading(true);
      try {
        const blob = await apiBlob('/invoices/preview', { body: { ...body, id: id ? Number(id) : undefined }, signal: ac.signal });
        setPreviewBlob(blob);
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.warn(e);
      } finally {
        if (!ac.signal.aborted) setPreviewLoading(false);
      }
    }, previewBlob ? 650 : 50);
    return () => clearTimeout(t);
  }, [body, wantPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  if (settingsQ.error || clientsQ.error || invQ.error) return <><PageHeader back title={tr('فاتورة')} /><ErrorBox error={settingsQ.error || clientsQ.error || invQ.error} /></>;
  if (!f || !s) return <Loading />;

  const setItem = (idx: number, patch: Partial<Item>) => update({ items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
  const addItem = () => update({ items: [...f.items, { id: uid(), description: '', qty: '1', unit: s.units[0] || 'Stk.', price: '', tax_rate: s.tax.defaultRate }] });
  const removeItem = (idx: number) => update({ items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items });
  const moveItem = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= f.items.length) return;
    const items = [...f.items];
    [items[idx], items[j]] = [items[j], items[idx]];
    update({ items });
  };

  const changeLangOrKind = (patch: Partial<Pick<Form, 'language' | 'kind'>>) => {
    const next = { ...f, ...patch };
    if (!textsTouched) {
      const t = defaultTexts(s, next.kind, next.language);
      update({ ...patch, intro_text: t.intro, outro_text: t.outro });
    } else update(patch);
  };

  const pickClient = (c: Client) => {
    setClientPicker(false);
    const patch: Partial<Form> = { client_id: c.id };
    if (c.language !== f.language && isNew) {
      patch.language = c.language;
      if (!textsTouched) {
        const t = defaultTexts(s, f.kind, c.language);
        patch.intro_text = t.intro;
        patch.outro_text = t.outro;
      }
    }
    update(patch);
  };

  const setPeriod = (which: 'this' | 'last' | 'none') => {
    if (which === 'none') return update({ service_from: '', service_to: '' });
    const ym = which === 'this' ? f.issue_date.slice(0, 7) : shiftYm(f.issue_date.slice(0, 7), -1);
    const r = ymRange(ym);
    update({ service_from: r.start, service_to: r.end });
  };

  const persist = async (): Promise<number | null> => {
    if (!body) return null;
    const existingId = id ? Number(id) : createdId.current;
    if (!existingId) {
      const r = await api<{ id: number }>('/invoices', { body });
      createdId.current = r.id;
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      return r.id;
    }
    await api(`/invoices/${existingId}`, { method: 'PUT', body });
    setDirty(false);
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['invoice', String(existingId)] });
    return existingId;
  };

  const saveDraft = async () => {
    setSaving('save');
    try {
      const newId = await persist();
      toast(tr('انحفظت المسودة'));
      if (isNew && newId) nav(`/invoices/${newId}/edit`, { replace: true });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const issue = async () => {
    if (!f.client_id) return toast(tr('اختار العميل أول'), 'error');
    if (!f.items.some((it) => it.description.trim())) return toast(tr('اكتب وصف لبند واحد على الأقل'), 'error');
    if (f.kind === 'invoice' && totals.total <= 0) return toast(tr('مبلغ الفاتورة لازم يكون أكبر من صفر'), 'error');
    const ok = await confirm({
      title: f.kind === 'quote' ? tr('إصدار عرض السعر؟') : tr('إصدار الفاتورة؟'),
      text: <>{tr('رح ياخد رقم رسمي متسلسل وبينقفل.')} {f.kind === 'invoice' && <Rich text={tr('بعد الإصدار التعديل بيصير عن طريق **تصحيح** (فاتورة إلغاء + نسخة جديدة) حسب القانون الألماني.')} />}<div className="mt-3 rounded-2xl bg-gray-50 p-3 text-gray-800"><b>{clientName(client)}</b> · <Money cents={totals.total} className="font-bold" /></div></>,
      confirm: tr('إصدار'),
    });
    if (!ok) return;
    setSaving('issue');
    try {
      const newId = await persist();
      if (!newId) return;
      await api(`/invoices/${newId}/issue`, { method: 'POST' });
      qc.removeQueries({ queryKey: ['invoice', String(newId)] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['month'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      toast(f.kind === 'quote' ? tr('صدر عرض السعر') : tr('صدرت الفاتورة'));
      nav(`/invoices/${newId}`, { replace: true });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeDraft = async () => {
    const existingId = id ? Number(id) : createdId.current;
    if (!existingId) return nav(-1);
    if (!(await confirm({ title: tr('حذف المسودة؟'), confirm: tr('حذف'), danger: true }))) return;
    await api(`/invoices/${existingId}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    qc.invalidateQueries({ queryKey: ['invoices'] });
    toast(tr('انحذفت المسودة'));
    nav('/invoices', { replace: true });
  };

  const units = Array.from(new Set([...(s.units || []), ...f.items.map((i) => i.unit).filter(Boolean)]));
  const related = invQ.data?.related;

  const formCol = (
    <div className="space-y-4">
      {related && <div className="rounded-2xl bg-violet-50 p-3 text-sm text-violet-800">{related.kind === 'quote' ? tr('من عرض السعر') : tr('تصحيح للفاتورة')} <b className="num">{related.number}</b></div>}

      <Segmented value={f.kind} onChange={(v) => changeLangOrKind({ kind: v })} options={[{ value: 'invoice', label: tr('فاتورة') }, { value: 'quote', label: tr('عرض سعر') }]} />

      {/* Client */}
      <Card className="p-4">
        <div className="mb-2 text-[13px] font-semibold text-gray-700">{tr('العميل')}</div>
        {client ? (
          <button type="button" onClick={() => setClientPicker(true)} className="group flex w-full items-center gap-3 rounded-2xl bg-gray-50 p-3 text-start transition hover:bg-gray-100">
            <div className="icon-pop flex size-11 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm"><Building2 className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-gray-900">{clientName(client)}</div>
              <div className="truncate text-xs text-gray-500">{[client.contact !== client.company && client.contact, client.street, `${client.zip} ${client.city}`.trim()].filter(Boolean).join(' · ')}</div>
            </div>
            <span className="text-sm font-semibold text-brand-600">{tr('تغيير')}</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="soft" icon={<Search className="size-4.5" />} onClick={() => setClientPicker(true)}>{tr('اختار عميل')}</Button>
            <Button variant="secondary" icon={<UserPlus className="size-4.5" />} onClick={() => setNewClient(true)}>{tr('عميل جديد')}</Button>
          </div>
        )}
      </Card>

      {/* Details */}
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.kind === 'quote' ? tr('تاريخ العرض') : tr('تاريخ الفاتورة')}>
            <input type="date" className="field" value={f.issue_date} onChange={(e) => update({ issue_date: e.target.value })} />
          </Field>
          <Field label={f.kind === 'quote' ? tr('صالح لغاية') : tr('تاريخ الاستحقاق')}>
            <input type="date" className="field" value={f.due_date} onChange={(e) => { setDueTouched(true); update({ due_date: e.target.value }); }} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2">
            <span className="text-[13px] font-semibold text-gray-700">{tr('فترة الخدمة')}</span>
            <div className="flex gap-1">
              {(['this', 'last', 'none'] as const).map((w) => (
                <button key={w} type="button" onClick={() => setPeriod(w)} className="whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50">
                  {w === 'this' ? tr('هالشهر') : w === 'last' ? tr('الشهر الماضي') : tr('مسح')}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="date" className="field" aria-label={tr('من')} value={f.service_from} onChange={(e) => update({ service_from: e.target.value })} />
            <input type="date" className="field" aria-label={tr('إلى')} value={f.service_to} onChange={(e) => update({ service_to: e.target.value })} />
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><CalendarRange className="size-3.5" /> {tr('إذا فاضية، تاريخ الفاتورة بيعتبر تاريخ الخدمة')}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={tr('لغة الفاتورة')} group>
            <Segmented size="sm" value={f.language} onChange={(v) => changeLangOrKind({ language: v })} options={[{ value: 'de', label: tr('ألماني') }, { value: 'en', label: tr('إنكليزي') }]} />
          </Field>
          {standard && (
            <Field label={tr('الضريبة')}>
              <select className="field" value={f.tax_treatment} onChange={(e) => update({ tax_treatment: e.target.value as Form['tax_treatment'] })}>
                <option value="auto">{tr('عادية (ضريبة مبيعات ألمانية)')}</option>
                <option value="reverse_charge">{tr('عميل بالاتحاد الأوروبي — Reverse Charge')}</option>
                <option value="export">{tr('عميل برا الاتحاد الأوروبي')}</option>
              </select>
            </Field>
          )}
        </div>
        <Field label={tr('العنوان (اختياري)')} hint={tr('بيظهر تحت رقم الفاتورة، مثلاً: Marketing-Leistungen Oktober 2026')}>
          <input className="field" dir="auto" value={f.title} onChange={(e) => update({ title: e.target.value })} />
        </Field>
      </Card>

      {/* Items */}
      <div>
        <div className="mb-2 px-1 text-[15px] font-bold text-gray-800">{tr('البنود')}</div>
        <div className="space-y-3">
          {f.items.map((it, idx) => {
            const lineTotal = Math.round((parseAmount(it.qty) ?? 0) * Math.round((parseAmount(it.price) ?? 0) * 100));
            return (
              <Card key={it.id} className="p-4 animate-fade-up">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700 num">{idx + 1}</span>
                  <div className="flex items-center">
                    <IconButton label={tr('لفوق')} className="size-8" onClick={() => moveItem(idx, -1)} disabled={idx === 0}><ChevronUp className="size-4.5" /></IconButton>
                    <IconButton label={tr('لتحت')} className="size-8" onClick={() => moveItem(idx, 1)} disabled={idx === f.items.length - 1}><ChevronDown className="size-4.5" /></IconButton>
                    <IconButton label={tr('حذف البند')} className="size-8 text-red-500 hover:bg-red-50" onClick={() => removeItem(idx)} disabled={f.items.length === 1}><Trash2 className="size-4.5" /></IconButton>
                  </div>
                </div>
                <textarea className="field !min-h-[4.5rem]" dir="auto" rows={2} placeholder={tr('الوصف — أول سطر عريض\nوالسطور التانية تفاصيل')} value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                <div className={cx('mt-3 grid gap-2.5', standard && f.tax_treatment === 'auto' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
                  <Field label={tr('الكمية')}><input className="field num text-left" dir="ltr" inputMode="decimal" value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} /></Field>
                  <Field label={tr('الوحدة')}>
                    <select className="field" dir="ltr" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                      <option value="">—</option>
                    </select>
                  </Field>
                  <Field label={tr('السعر €')}><input className="field num text-left" dir="ltr" inputMode="decimal" placeholder="0,00" value={it.price} onChange={(e) => setItem(idx, { price: e.target.value })} /></Field>
                  {standard && f.tax_treatment === 'auto' && (
                    <Field label={tr('الضريبة')}>
                      <select className="field" value={it.tax_rate} onChange={(e) => setItem(idx, { tax_rate: Number(e.target.value) })}>
                        <option value={19}>19%</option><option value={7}>7%</option><option value={0}>0%</option>
                      </select>
                    </Field>
                  )}
                </div>
                <div className="mt-2 text-end text-sm text-gray-500">{tr('المجموع:')} <Money cents={lineTotal} className="font-bold text-gray-900" /></div>
              </Card>
            );
          })}
        </div>
        <Button variant="soft" block className="mt-3" icon={<Plus className="size-5" />} onClick={addItem}>{tr('بند جديد')}</Button>
      </div>

      {/* Totals */}
      <Card className="p-4">
        {standard && (
          <>
            <Row label={tr('المجموع الصافي')} cents={totals.net} />
            {totals.lines.map((l) => <Row key={l.rate} label={tr('ضريبة {0}%', [l.rate])} cents={l.tax} />)}
          </>
        )}
        <div className="mt-1 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="font-bold">{tr('المجموع الكلي')}</span>
          <Money cents={totals.total} className="text-2xl font-bold text-brand-700" />
        </div>
        {!standard && <p className="mt-1 text-xs text-gray-500">{tr('بدون ضريبة مبيعات (المادة ١٩ للمشاريع الصغيرة) — فيك تغيّرها من الإعدادات')}</p>}
      </Card>

      {/* Texts */}
      <Card className="space-y-4 p-4">
        <Field label={tr('النص قبل البنود')} hint={tr('الفاتورة بتطلع بالألماني أو الإنكليزي حسب لغتها')}>
          <textarea className="field" dir="ltr" rows={3} value={f.intro_text} onChange={(e) => { setTextsTouched(true); update({ intro_text: e.target.value }); }} />
        </Field>
        <Field label={tr('النص بعد البنود')} hint={tr('{due} = تاريخ الاستحقاق، {valid} = صالح لغاية')}>
          <textarea className="field" dir="ltr" rows={3} value={f.outro_text} onChange={(e) => { setTextsTouched(true); update({ outro_text: e.target.value }); }} />
        </Field>
        <Field label={tr('ملاحظة داخلية')} hint={tr('ما بتظهر على الفاتورة')}>
          <textarea className="field" rows={2} value={f.internal_note} onChange={(e) => update({ internal_note: e.target.value })} />
        </Field>
      </Card>
    </div>
  );

  return (
    <div className="animate-fade-up lg:-me-4">
      <PageHeader back="/invoices" title={isNew ? (f.kind === 'quote' ? tr('عرض سعر جديد') : tr('فاتورة جديدة')) : tr('تعديل {0} (مسودة)', [KIND_LABEL[f.kind]])}
        subtitle={dirty ? tr('في تغييرات مو محفوظة') : !isNew ? tr('محفوظة كمسودة') : undefined}
        actions={<IconButton label={tr('حذف المسودة')} onClick={removeDraft} className="text-red-600 hover:bg-red-50"><Trash2 className="size-5" /></IconButton>} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
        <div>
          {formCol}
      {/* Action bar */}
          <div className="safe-bottom sticky bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 mt-5 lg:bottom-4">
            <div className="flex gap-2 rounded-[1.4rem] bg-white/95 p-2 shadow-[var(--shadow-lift)] ring-1 ring-gray-200 backdrop-blur">
              {!isDesktop && <Button variant="secondary" className="shrink-0" aria-label={tr('معاينة')} icon={<Eye className="size-5" />} onClick={() => setPreviewOpen(true)}><span className="max-[420px]:hidden">{tr('معاينة')}</span></Button>}
              <Button variant="secondary" className="min-w-0 flex-1 lg:flex-none" loading={saving === 'save'} icon={<Save className="size-5" />} onClick={saveDraft}>{tr('مسودة')}</Button>
              <Button variant="success" className="min-w-0 flex-1" loading={saving === 'issue'} icon={<Send className="size-5" />} onClick={issue}>{tr('إصدار')}</Button>
            </div>
          </div>
        </div>
        {isDesktop && (
          <div className="sticky top-6 self-start">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[15px] font-bold text-gray-800">{tr('معاينة مباشرة')}</span>
              <span className="text-xs text-gray-500">{tr('بتتحدث وإنت عم تكتب')}</span>
            </div>
            <div className="max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-2xl bg-gray-100 p-3">
              <PdfPreview blob={previewBlob} loading={previewLoading} />
            </div>
          </div>
        )}
      </div>

      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={tr('معاينة')} wide>
        <div className="rounded-2xl bg-gray-100 p-2"><PdfPreview blob={previewBlob} loading={previewLoading} /></div>
      </Sheet>

      <ClientPicker open={clientPicker} onClose={() => setClientPicker(false)} clients={clientsQ.data || []} selected={f.client_id} onPick={pickClient} onNew={() => { setClientPicker(false); setNewClient(true); }} />
      <ClientForm open={newClient} onClose={() => setNewClient(false)} onSaved={async (cid) => {
        const list = await qc.fetchQuery<Client[]>({ queryKey: ['clients'], queryFn: () => api('/clients') });
        const c = list.find((x) => x.id === cid);
        if (c) pickClient(c);
      }} />
    </div>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm text-gray-600">
      <span>{label}</span>
      <span className="num">{fmtEur(cents)}</span>
    </div>
  );
}

function ClientPicker({ open, onClose, clients, selected, onPick, onNew }: { open: boolean; onClose: () => void; clients: Client[]; selected: number | null; onPick: (c: Client) => void; onNew: () => void }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  const list = clients.filter((c) => !q.trim() || [c.company, c.contact, c.city, c.email].some((v) => (v || '').toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <Sheet open={open} onClose={onClose} title={tr('اختار العميل')}>
      <div className="sticky top-0 z-10 -mx-5 bg-white px-5 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4.5 text-gray-400" />
          <input className="field !ps-10" placeholder={tr('بحث…')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus={window.matchMedia('(min-width: 1024px)').matches} />
        </div>
      </div>
      <button type="button" onClick={onNew} className="group mb-2 flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-brand-200 p-3 text-start font-semibold text-brand-700 hover:bg-brand-50">
        <UserPlus className="icon-pop size-5" /> {tr('عميل جديد')}
      </button>
      <div className="divide-y divide-gray-100">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c)} className="flex w-full items-center gap-3 px-1 py-3 text-start transition hover:bg-gray-50">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 font-bold text-gray-600">{clientName(c).slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-gray-900">{clientName(c)}</div>
              <div className="truncate text-xs text-gray-500">{[c.company && c.contact, c.city].filter(Boolean).join(' · ')}</div>
            </div>
            {selected === c.id && <Check className="size-5 text-brand-600" />}
          </button>
        ))}
        {list.length === 0 && <div className="py-6 text-center text-sm text-gray-500">{tr('ما لقيت عميل بهالاسم')}</div>}
      </div>
    </Sheet>
  );
}
