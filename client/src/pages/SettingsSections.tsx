import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Plus, DatabaseBackup, RotateCcw, Check, ShieldCheck, Pencil, UserPlus, Repeat, ImageIcon } from 'lucide-react';
import { api, apiBlob, downloadFrom } from '../lib/api';
import type { Entry, Settings, Subscription, User } from '../lib/types';
import { METHODS, centsToInput, currentYm, fmtDate, folderLabel, methodLabel, parseAmount, ymLabel } from '../lib/format';
import { logoToPng } from '../lib/image';
import { Button, Card, Field, Loading, ErrorBox, PageHeader, Segmented, Sheet, useUi, Money, Badge, Empty, Chips, cx, IconButton } from '../components/ui';
import PdfPreview from '../components/PdfPreview';
import EntryRow from '../components/EntryRow';
import { SECTIONS } from './Settings';
import { tr } from '../lib/i18n';

export default function SettingsSection() {
  const { section = '' } = useParams();
  const meta = SECTIONS.find((s) => s.key === section);
  if (!meta) return <Navigate to="/settings" replace />;
  const C = { company: Company, design: Design, tax: Tax, subscriptions: Subscriptions, account: Account, backup: Backup, trash: Trash, audit: Audit }[section as 'company'];
  return (
    <div className="animate-fade-up">
      <PageHeader back="/settings" title={meta.label} />
      <C />
    </div>
  );
}

function useSettings() {
  return useQuery<Settings>({ queryKey: ['settings'], queryFn: () => api('/settings') });
}

// ───────────── Company ─────────────
function Company() {
  const q = useSettings();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [c, setC] = useState<Settings['company'] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data && !c) setC(q.data.company); }, [q.data, c]);
  if (q.isLoading || !c) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const set = (k: keyof Settings['company']) => (e: React.ChangeEvent<HTMLInputElement>) => setC({ ...c, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PUT', body: { company: c } });
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast(tr('انحفظت بيانات الشركة'));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const F = ({ k, label, hint, ltr, span }: { k: keyof Settings['company']; label: string; hint?: string; ltr?: boolean; span?: boolean }) => (
    <Field label={label} hint={hint} className={span ? 'sm:col-span-2' : ''}><input className="field" dir={ltr ? 'ltr' : 'auto'} value={c[k]} onChange={set(k)} /></Field>
  );
  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2 text-[15px] font-bold">{tr('الشركة')}</div>
        {F({ k: 'name', label: tr('اسم الشركة'), span: true })}
        {F({ k: 'owner', label: tr('اسم صاحب/ة الشركة'), hint: tr('لازم يظهر على الفواتير للمؤسسة الفردية') })}
        {F({ k: 'street', label: tr('الشارع ورقم البناية') })}
        {F({ k: 'zip', label: tr('الرمز البريدي'), ltr: true })}
        {F({ k: 'city', label: tr('المدينة') })}
        {F({ k: 'country', label: tr('البلد') })}
        {F({ k: 'phone', label: tr('الهاتف'), ltr: true })}
        {F({ k: 'email', label: tr('الإيميل'), ltr: true })}
        {F({ k: 'website', label: tr('الموقع'), ltr: true })}
      </Card>
      <Card className="grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2 text-[15px] font-bold">{tr('الضرائب')}</div>
        {F({ k: 'vatId', label: tr('رقم ضريبة القيمة المضافة'), hint: 'USt-IdNr.', ltr: true })}
        {F({ k: 'taxNumber', label: tr('الرقم الضريبي من مكتب الضرائب'), hint: tr('Steuernummer — اختياري إذا في رقم القيمة المضافة'), ltr: true })}
      </Card>
      <Card className="grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2 text-[15px] font-bold">{tr('البنك')}</div>
        {F({ k: 'bankName', label: tr('اسم البنك') })}
        {F({ k: 'accountHolder', label: tr('صاحب الحساب') })}
        {F({ k: 'iban', label: 'IBAN', ltr: true })}
        {F({ k: 'bic', label: 'BIC', ltr: true })}
      </Card>
      <Button size="lg" block loading={busy} onClick={save} icon={<Check className="size-5" />}>{tr('حفظ')}</Button>
    </div>
  );
}

// ───────────── Invoice design ─────────────
const COLORS = ['#4f46e5', '#0f766e', '#0369a1', '#7c3aed', '#be123c', '#c2410c', '#111827', '#15803d'];
const SAMPLE = {
  kind: 'invoice', language: 'de', title: 'Marketing-Leistungen Oktober',
  client: { company: 'Musterfirma GmbH', contact: 'Frau Anna Beispiel', street: 'Hauptstraße 1', zip: '45127', city: 'Essen', customer_no: 'K-0001' },
  items: [
    { description: 'Social Media Betreuung\nInstagram & Facebook, 12 Beiträge, Community Management', qty: 1, unit: 'Monat', price: 1200 },
    { description: 'Meta Ads Kampagnenmanagement', qty: 1, unit: 'Pauschal', price: 450 },
    { description: 'Content-Produktion Fotos & Reels', qty: 4, unit: 'Std.', price: 85 },
  ],
};

function Design() {
  const q = useSettings();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [d, setD] = useState<Settings['invoice'] | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoV, setLogoV] = useState(0);
  const [saved, setSaved] = useState(false);
  const first = useRef(true);

  useEffect(() => { if (q.data && !d) setD(q.data.invoice); }, [q.data, d]);

  const refreshPreview = async (inv = d) => {
    if (!inv) return;
    setLoading(true);
    try {
      setBlob(await apiBlob('/invoices/preview', { body: { ...SAMPLE, intro_text: inv.introDe, outro_text: inv.outroDe } }));
    } finally {
      setLoading(false);
    }
  };

  // auto-save design changes then refresh preview
  useEffect(() => {
    if (!d) return;
    if (first.current) { first.current = false; refreshPreview(d); return; }
    const t = setTimeout(async () => {
      try {
        await api('/settings', { method: 'PUT', body: { invoice: d } });
        qc.invalidateQueries({ queryKey: ['settings'] });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        refreshPreview(d);
      } catch (e: any) {
        toast(e.message, 'error');
      }
    }, 450);
    return () => clearTimeout(t);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading || !d) return <Loading />;
  const set = <K extends keyof Settings['invoice']>(k: K, v: Settings['invoice'][K]) => setD({ ...d, [k]: v });

  const uploadLogo = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const png = await logoToPng(file);
        const fd = new FormData();
        fd.append('logo', png);
        await api('/settings/logo', { form: fd });
        await qc.invalidateQueries({ queryKey: ['settings'] });
        setD((p) => (p ? { ...p, hasLogo: true } : p));
        setLogoV((v) => v + 1);
        toast(tr('انرفع اللوغو'));
      } catch (e: any) {
        toast(e.message, 'error');
      }
    };
    input.click();
  };
  const removeLogo = async () => {
    await api('/settings/logo', { method: 'DELETE' });
    setD((p) => (p ? { ...p, hasLogo: false } : p));
    setLogoV((v) => v + 1);
  };

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-6">
      <div className="space-y-4">
        <div className="flex h-5 items-center justify-end text-xs font-semibold text-emerald-600">{saved && <><Check className="me-1 size-4" /> {tr('انحفظ تلقائياً')}</>}</div>
        <Card className="p-4">
          <div className="mb-3 text-[15px] font-bold">{tr('اللوغو')}</div>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-36 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-gray-50">
              {d.hasLogo ? <img src={`/api/settings/logo?v=${logoV}`} alt="Logo" className="max-h-16 max-w-32 object-contain" /> : <ImageIcon className="size-7 text-gray-300" />}
            </div>
            <div className="flex flex-col gap-2">
              <Button size="sm" icon={<Upload className="size-4" />} onClick={uploadLogo}>{d.hasLogo ? tr('تغيير') : tr('رفع اللوغو')}</Button>
              {d.hasLogo && <Button size="sm" variant="ghost" className="text-red-600" onClick={removeLogo}>{tr('حذف')}</Button>}
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">{tr('PNG شفاف أو SVG بيطلع أحلى شي')}</p>
          {d.hasLogo && (
            <div className="mt-4 space-y-3">
              <Field label={tr('مكان اللوغو')} group>
                <Segmented size="sm" value={d.logoPosition} onChange={(v) => set('logoPosition', v)} options={[{ value: 'left', label: tr('يسار') }, { value: 'center', label: tr('وسط') }, { value: 'right', label: tr('يمين') }]} />
              </Field>
              <Field label={<>{tr('حجم اللوغو')} <span className="num text-gray-400">{d.logoSize}</span></>}>
                <input type="range" min={60} max={240} step={5} value={d.logoSize} onChange={(e) => set('logoSize', Number(e.target.value))} className="w-full accent-brand-600" />
              </Field>
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-4">
          <Field label={tr('القالب')} group>
            <div className="grid grid-cols-3 gap-2">
              {(['modern', 'classic', 'minimal'] as const).map((t) => (
                <button key={t} type="button" onClick={() => set('template', t)} className={cx('group rounded-2xl border-2 p-2 text-center text-sm font-semibold transition', d.template === t ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  <TemplateIcon t={t} color={d.accentColor} />
                  {t === 'modern' ? tr('عصري') : t === 'classic' ? tr('كلاسيكي') : tr('بسيط')}
                </button>
              ))}
            </div>
          </Field>
          <Field label={tr('لون الهوية')} group>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => set('accentColor', c)} className={cx('size-9 rounded-full ring-offset-2 transition active:scale-90', d.accentColor === c && 'ring-2 ring-gray-900')} style={{ background: c }} />
              ))}
              <label className="relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-gray-300 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" title={tr('لون مخصص')}>
                <input type="color" value={d.accentColor} onChange={(e) => set('accentColor', e.target.value)} className="absolute inset-0 opacity-0" />
              </label>
              <span className="num text-sm text-gray-500">{d.accentColor}</span>
            </div>
          </Field>
          <Field label={tr('الخط')} group>
            <Segmented size="sm" value={d.font} onChange={(v) => set('font', v)} options={[{ value: 'inter', label: 'Inter' }, { value: 'manrope', label: 'Manrope' }, { value: 'serif', label: 'Serif' }]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Toggle label={tr('معلومات البنك')} checked={d.showBank} onChange={(v) => set('showBank', v)} />
            <Toggle label={tr('رمز الدفع QR')} checked={d.showQr} onChange={(v) => set('showQr', v)} />
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="text-[15px] font-bold">{tr('الافتراضيات')}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr('مهلة الدفع (أيام)')}><input className="field num" inputMode="numeric" value={d.paymentDays} onChange={(e) => set('paymentDays', Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
            <Field label={tr('صلاحية العرض (أيام)')}><input className="field num" inputMode="numeric" value={d.quoteValidDays} onChange={(e) => set('quoteValidDays', Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
          </div>
          <Field label={tr('لغة الفاتورة الافتراضية')} group>
            <Segmented size="sm" value={d.defaultLanguage} onChange={(v) => set('defaultLanguage', v)} options={[{ value: 'de', label: tr('ألماني') }, { value: 'en', label: tr('إنكليزي') }]} />
          </Field>
        </Card>

        <TextsCard d={d} set={set} />
      </div>

      <div className="mt-5 lg:sticky lg:top-6 lg:mt-0 lg:self-start">
        <div className="mb-2 px-1 text-[15px] font-bold">{tr('معاينة')}</div>
        <div className="rounded-2xl bg-gray-100 p-2 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto"><PdfPreview blob={blob} loading={loading} /></div>
      </div>
    </div>
  );
}

function TextsCard({ d, set }: { d: Settings['invoice']; set: <K extends keyof Settings['invoice']>(k: K, v: Settings['invoice'][K]) => void }) {
  const [lang, setLang] = useState<'De' | 'En'>('De');
  const k = (base: string) => `${base}${lang}` as keyof Settings['invoice'];
  const T = ({ base, label }: { base: string; label: string }) => (
    <Field label={label}><textarea className="field" dir="ltr" rows={3} value={d[k(base)] as string} onChange={(e) => set(k(base), e.target.value as never)} /></Field>
  );
  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-bold">{tr('النصوص الجاهزة')}</div>
        <Segmented size="sm" value={lang} onChange={setLang} options={[{ value: 'De', label: 'DE' }, { value: 'En', label: 'EN' }]} />
      </div>
      {T({ base: 'intro', label: tr('الفاتورة — قبل البنود') })}
      {T({ base: 'outro', label: tr('الفاتورة — بعد البنود') })}
      {T({ base: 'quoteIntro', label: tr('عرض السعر — قبل البنود') })}
      {T({ base: 'quoteOutro', label: tr('عرض السعر — بعد البنود') })}
      <Field label={tr('سطر إضافي بأسفل الصفحة (اختياري)')}><input className="field" dir="ltr" value={d.footerNote} onChange={(e) => set('footerNote', e.target.value)} /></Field>
      <p className="text-xs text-gray-500">{'{due}'} {tr('= تاريخ الاستحقاق ·')} {'{valid}'} {tr('= صالح لغاية ·')} {'{number}'} {tr('= رقم الفاتورة')}</p>
    </Card>
  );
}

function TemplateIcon({ t, color }: { t: string; color: string }) {
  return (
    <svg viewBox="0 0 60 80" className="mx-auto mb-1.5 h-16 w-12 rounded-md bg-white shadow-sm ring-1 ring-gray-200">
      {t === 'modern' && <rect x="0" y="0" width="60" height="3" fill={color} />}
      <rect x="6" y="9" width="18" height="5" rx="1" fill={t === 'minimal' ? '#111827' : color} />
      <rect x="38" y="9" width="16" height="2" fill="#d1d5db" /><rect x="38" y="13" width="12" height="2" fill="#d1d5db" />
      <rect x="6" y="22" width="20" height="2" fill="#9ca3af" /><rect x="6" y="26" width="16" height="2" fill="#d1d5db" />
      <rect x="6" y="34" width="26" height="4" rx="1" fill={t === 'classic' ? '#111827' : color} />
      {t === 'modern' ? <rect x="6" y="42" width="48" height="4" rx="1" fill={color} /> : <rect x="6" y="45" width="48" height="0.8" fill="#111827" />}
      <rect x="6" y="50" width="48" height="1.5" fill="#e5e7eb" /><rect x="6" y="55" width="48" height="1.5" fill="#e5e7eb" /><rect x="6" y="60" width="48" height="1.5" fill="#e5e7eb" />
      {t === 'modern' ? <rect x="32" y="65" width="22" height="5" rx="1" fill={color} /> : <rect x="32" y="66" width="22" height="3" fill={t === 'minimal' ? color : '#111827'} />}
    </svg>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex items-center justify-between gap-2 rounded-2xl bg-gray-50 px-3.5 py-3 text-sm font-semibold text-gray-700">
      {label}
      <span className={cx('relative h-6 w-10 rounded-full transition', checked ? 'bg-brand-600' : 'bg-gray-300')}>
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'start-[1.15rem]' : 'start-0.5')} />
      </span>
    </button>
  );
}

// ───────────── Tax & numbering ─────────────
function Tax() {
  const q = useSettings();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [mode, setMode] = useState<Settings['tax']['mode']>('kleinunternehmer');
  const [rate, setRate] = useState(19);
  const [num, setNum] = useState<Settings['numbering'] | null>(null);
  const [next, setNext] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data && !num) {
      setMode(q.data.tax.mode);
      setRate(q.data.tax.defaultRate);
      setNum(q.data.numbering);
      setNext({ invoice: String(q.data.counters.invoice), quote: String(q.data.counters.quote), storno: String(q.data.counters.storno) });
    }
  }, [q.data, num]);
  if (q.isLoading || !num || !q.data) return <Loading />;
  const year = q.data.counterYear;
  const preview = (p: string, n: string) => `${p}-${year}-${String(Number(n) || 1).padStart(num.digits, '0')}`;

  const save = async () => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PUT', body: { tax: { mode, defaultRate: rate }, numbering: num } });
      for (const kind of ['invoice', 'quote', 'storno'] as const) {
        if (String(q.data!.counters[kind]) !== next[kind]) await api('/settings/counter', { method: 'PUT', body: { kind, year, next: Number(next[kind]) } });
      }
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast(tr('انحفظت الإعدادات'));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="text-[15px] font-bold">{tr('ضريبة المبيعات')}</div>
        {([
          ['kleinunternehmer', tr('مشروع صغير — بدون ضريبة'), tr('المادة ١٩ من قانون الضريبة: الفواتير بدون ضريبة وبينكتب عليها الملاحظة القانونية تلقائياً. بس إذا مبيعات السنة الماضية تحت ٢٥ ألف يورو.')],
          ['standard', tr('ضريبة عادية'), tr('كل بند إلو نسبة ضريبة (١٩٪ أو ٧٪)، مع خيارات للعملاء الأوروبيين وبرا أوروبا.')],
        ] as const).map(([v, t, s]) => (
          <button key={v} type="button" onClick={() => setMode(v)} className={cx('flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-start transition', mode === v ? 'border-brand-600 bg-brand-50/60' : 'border-gray-200 hover:border-gray-300')}>
            <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2', mode === v ? 'border-brand-600 bg-brand-600' : 'border-gray-300')}>{mode === v && <span className="size-2 rounded-full bg-white" />}</span>
            <span><span className="block font-bold">{t}</span><span className="mt-0.5 block text-sm leading-relaxed text-gray-600">{s}</span></span>
          </button>
        ))}
        {mode === 'standard' && (
          <Field label={tr('النسبة الافتراضية للبنود')} group>
            <Segmented size="sm" value={String(rate)} onChange={(v) => setRate(Number(v))} options={[{ value: '19', label: '19%' }, { value: '7', label: '7%' }, { value: '0', label: '0%' }]} />
          </Field>
        )}
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" /> {tr('التغيير بيأثر بس على الفواتير الجديدة. الفواتير الصادرة بتضل متل ما هي. تأكد من الوضع الصحيح مع المستشار الضريبي.')}
        </p>
      </Card>

      <Card className="space-y-4 p-4">
        <div className="text-[15px] font-bold">{tr('ترقيم الفواتير')}</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={tr('بادئة الفاتورة')}><input className="field num uppercase" value={num.invoicePrefix} onChange={(e) => setNum({ ...num, invoicePrefix: e.target.value })} /></Field>
          <Field label={tr('بادئة العرض')}><input className="field num uppercase" value={num.quotePrefix} onChange={(e) => setNum({ ...num, quotePrefix: e.target.value })} /></Field>
          <Field label={tr('بادئة الإلغاء')}><input className="field num uppercase" value={num.stornoPrefix} onChange={(e) => setNum({ ...num, stornoPrefix: e.target.value })} /></Field>
        </div>
        <Field label={tr('عدد الخانات')} group>
          <Segmented size="sm" value={String(num.digits)} onChange={(v) => setNum({ ...num, digits: Number(v) })} options={[{ value: '3', label: '001' }, { value: '4', label: '0001' }, { value: '5', label: '00001' }]} />
        </Field>
        <div className="text-[13px] font-semibold text-gray-700">{tr('الرقم الجاي لسنة')} <span className="num">{year}</span></div>
        <div className="grid grid-cols-3 gap-3">
          {(['invoice', 'quote', 'storno'] as const).map((k) => (
            <Field key={k} hint={<span className="num">{preview(k === 'invoice' ? num.invoicePrefix : k === 'quote' ? num.quotePrefix : num.stornoPrefix, next[k])}</span>}>
              <input aria-label={k === 'invoice' ? tr('رقم الفاتورة الجاي') : k === 'quote' ? tr('رقم العرض الجاي') : tr('رقم الإلغاء الجاي')} className="field num" inputMode="numeric" value={next[k]} onChange={(e) => setNext({ ...next, [k]: e.target.value.replace(/\D/g, '') })} />
            </Field>
          ))}
        </div>
        <p className="text-xs text-gray-500">{tr('إذا عملت فواتير هالسنة قبل البرنامج، حط الرقم الجاي هون. ما فيك ترجع الترقيم لورا.')}</p>
      </Card>
      <Button size="lg" block loading={busy} onClick={save} icon={<Check className="size-5" />}>{tr('حفظ')}</Button>
    </div>
  );
}

// ───────────── Subscriptions ─────────────
function Subscriptions() {
  const q = useQuery<Subscription[]>({ queryKey: ['subscriptions'], queryFn: () => api('/subscriptions') });
  const [edit, setEdit] = useState<Subscription | 'new' | null>(null);
  if (q.isLoading) return <Loading />;
  const list = q.data || [];
  const monthly = list.filter((s) => s.active && s.interval === 'monthly').reduce((a, s) => a + s.amount_cents, 0);
  return (
    <div>
      <p className="mb-4 text-[15px] leading-relaxed text-gray-600">{tr('عرّف كل شي بيندفع بشكل دوري. كل شهر بيظهرلك بقائمة الشهر، وبتعرف فوراً شو الإيصالات الناقصة.')}</p>
      <Button block className="mb-4" icon={<Plus className="size-5" />} onClick={() => setEdit('new')}>{tr('اشتراك جديد')}</Button>
      {list.length === 0 ? (
        <Card><Empty icon={<Repeat className="size-6" />} title={tr('ما في اشتراكات لسا')} text={tr('مثلاً: Google Workspace، Adobe، كلاود، إيجار المكتب، الهاتف')} /></Card>
      ) : (
        <>
          <Card className="divide-y divide-gray-100">
            {list.map((s) => (
              <button key={s.id} type="button" onClick={() => setEdit(s)} className="flex w-full items-center gap-3 p-4 text-start transition hover:bg-gray-50">
                <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', s.active ? 'bg-violet-50 text-violet-600' : 'bg-gray-100 text-gray-400')}><Repeat className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-gray-900">{s.name}</div>
                  <div className="text-xs text-gray-500">{s.interval === 'monthly' ? tr('شهري') : s.interval === 'quarterly' ? tr('كل ٣ شهور') : tr('سنوي')} · {methodLabel(s.payment_method)} {tr('· من')} {ymLabel(s.start_ym)}</div>
                </div>
                <div className="flex flex-col items-end gap-1"><Money cents={s.amount_cents} className="font-bold" />{!s.active && <Badge>{tr('متوقف')}</Badge>}</div>
              </button>
            ))}
          </Card>
          <p className="mt-3 text-center text-sm text-gray-500">{tr('المصاريف الشهرية الثابتة:')} <Money cents={monthly} className="font-bold text-gray-800" /></p>
        </>
      )}
      <SubForm open={!!edit} sub={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function SubForm({ open, sub, onClose }: { open: boolean; sub: Subscription | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const [f, setF] = useState({ name: '', vendor: '', amount: '', payment_method: 'card', folder: 'subscription', interval: 'monthly', start_ym: currentYm(), end_ym: '', active: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(sub ? { name: sub.name, vendor: sub.vendor, amount: centsToInput(sub.amount_cents), payment_method: sub.payment_method, folder: sub.folder, interval: sub.interval, start_ym: sub.start_ym, end_ym: sub.end_ym || '', active: !!sub.active }
      : { name: '', vendor: '', amount: '', payment_method: 'card', folder: 'subscription', interval: 'monthly', start_ym: currentYm(), end_ym: '', active: true });
  }, [open, sub]);
  const save = async () => {
    if (!f.name.trim()) return toast(tr('اكتب اسم الاشتراك'), 'error');
    setBusy(true);
    try {
      const body = { ...f, amount: parseAmount(f.amount) ?? 0, end_ym: f.end_ym || null };
      if (sub) await api(`/subscriptions/${sub.id}`, { method: 'PUT', body });
      else await api('/subscriptions', { body });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      qc.invalidateQueries({ queryKey: ['month'] });
      toast(tr('انحفظ الاشتراك'));
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!sub || !(await confirm({ title: tr('حذف الاشتراك؟'), text: tr('الإيصالات المرفوعة بتضل محفوظة.'), confirm: tr('حذف'), danger: true }))) return;
    await api(`/subscriptions/${sub.id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['subscriptions'] });
    qc.invalidateQueries({ queryKey: ['month'] });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={sub ? tr('تعديل الاشتراك') : tr('اشتراك جديد')}
      footer={<div className="flex gap-2">{sub && <Button variant="secondary" className="text-red-600" onClick={remove} icon={<Trash2 className="size-4.5" />}>{tr('حذف')}</Button>}<Button block loading={busy} onClick={save}>{tr('حفظ')}</Button></div>}>
      <div className="space-y-3.5 pt-1">
        <Field label={tr('الاسم')}><input className="field" dir="auto" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tr('مثلاً: Google Cloud')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('الشركة')}><input className="field" dir="auto" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="Google" /></Field>
          <Field label={tr('المبلغ التقريبي €')}><input className="field num text-left" dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="30,00" /></Field>
        </div>
        <Field label={tr('كل قديش؟')} group>
          <Segmented size="sm" value={f.interval} onChange={(v) => setF({ ...f, interval: v })} options={[{ value: 'monthly', label: tr('شهري') }, { value: 'quarterly', label: tr('٣ شهور') }, { value: 'yearly', label: tr('سنوي') }]} />
        </Field>
        <Field label={tr('طريقة الدفع')} group><Chips value={f.payment_method} onChange={(v) => setF({ ...f, payment_method: v })} options={METHODS.map((m) => ({ value: m.key, label: m.label }))} /></Field>
        <Field label={tr('المجلد')} group>
          <Segmented size="sm" value={f.folder} onChange={(v) => setF({ ...f, folder: v })} options={[{ value: 'subscription', label: folderLabel('subscription').split(' ')[0] }, { value: 'other', label: tr('مصاريف تانية') }]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('من شهر')}><input type="month" className="field" dir="ltr" value={f.start_ym} onChange={(e) => setF({ ...f, start_ym: e.target.value })} /></Field>
          <Field label={tr('لغاية (اختياري)')}><input type="month" className="field" dir="ltr" value={f.end_ym} onChange={(e) => setF({ ...f, end_ym: e.target.value })} /></Field>
        </div>
        {sub && <Toggle label={tr('فعّال')} checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      </div>
    </Sheet>
  );
}

// ───────────── Account ─────────────
function Account() {
  const { toast, confirm } = useUi();
  const qc = useQueryClient();
  const users = useQuery<User[]>({ queryKey: ['users'], queryFn: () => api('/auth/users') });
  const me = useQuery<{ user: User }>({ queryKey: ['auth'], queryFn: () => api('/auth/state') });
  const [pw, setPw] = useState({ current: '', password: '', password2: '' });
  const [nu, setNu] = useState({ name: '', email: '', password: '' });
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const changePw = async () => {
    if (pw.password !== pw.password2) return toast(tr('كلمتين السر مو متطابقين'), 'error');
    setBusy(true);
    try {
      await api('/auth/password', { body: pw });
      setPw({ current: '', password: '', password2: '' });
      toast(tr('تغيرت كلمة السر'));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const addUser = async () => {
    setBusy(true);
    try {
      await api('/auth/users', { body: nu });
      setNu({ name: '', email: '', password: '' });
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(tr('انضاف المستخدم'));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const delUser = async (u: User) => {
    if (!(await confirm({ title: tr('حذف {0}؟', [u.name]), confirm: tr('حذف'), danger: true }))) return;
    await api(`/auth/users/${u.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3.5 p-4">
        <div className="text-[15px] font-bold">{tr('تغيير كلمة السر')}</div>
        <Field label={tr('كلمة السر الحالية')}><input className="field" type="password" dir="ltr" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label={tr('كلمة السر الجديدة')} hint={tr('٨ أحرف على الأقل')}><input className="field" type="password" dir="ltr" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
        <Field label={tr('أعدها')}><input className="field" type="password" dir="ltr" autoComplete="new-password" value={pw.password2} onChange={(e) => setPw({ ...pw, password2: e.target.value })} /></Field>
        <Button loading={busy} onClick={changePw} disabled={!pw.current || !pw.password}>{tr('تغيير')}</Button>
      </Card>
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[15px] font-bold">{tr('المستخدمين')}</div>
          <Button size="sm" variant="soft" icon={<UserPlus className="size-4" />} onClick={() => setAddOpen(true)}>{tr('إضافة')}</Button>
        </div>
        <div className="divide-y divide-gray-100">
          {(users.data || []).map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">{u.name.slice(0, 1)}</div>
              <div className="min-w-0 flex-1"><div className="font-semibold">{u.name}</div><div className="truncate text-xs text-gray-500" dir="ltr">{u.email}</div></div>
              {me.data?.user?.id !== u.id && <IconButton label={tr('حذف')} onClick={() => delUser(u)} className="text-red-500"><Trash2 className="size-4.5" /></IconButton>}
            </div>
          ))}
        </div>
      </Card>
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={tr('مستخدم جديد')} footer={<Button block loading={busy} onClick={addUser}>{tr('إضافة')}</Button>}>
        <div className="space-y-3.5 pt-1">
          <Field label={tr('الاسم')}><input className="field" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} /></Field>
          <Field label={tr('الإيميل')}><input className="field" type="email" dir="ltr" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></Field>
          <Field label={tr('كلمة السر')} hint={tr('٨ أحرف على الأقل')}><input className="field" type="password" dir="ltr" autoComplete="new-password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></Field>
        </div>
      </Sheet>
    </div>
  );
}

// ───────────── Backup ─────────────
function Backup() {
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const dl = async () => {
    setBusy(true);
    try {
      await downloadFrom('/backup', 'GoTrend_Sicherung.zip');
      toast(tr('تم تحميل النسخة الاحتياطية'));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><ShieldCheck className="size-6" /></div>
        <div className="font-bold">{tr('بياناتك محمية')}</div>
        <ul className="mt-2 list-inside list-disc space-y-1 text-[15px] leading-relaxed text-gray-600">
          <li>{tr('كل شي محفوظ على الخادم، مو بالموبايل.')}</li>
          <li>{tr('الخادم بياخد نسخة احتياطية تلقائية كل يوم وبيحتفظ بآخر ٣٠ يوم.')}</li>
          <li>{tr('الفواتير الصادرة محفوظة كملفات PDF ثابتة ما بتتغير.')}</li>
          <li>{tr('الإيصالات المحذوفة بتروح لسلة المحذوفات أول.')}</li>
        </ul>
      </Card>
      <Card className="p-5">
        <div className="font-bold">{tr('نسخة على جهازك')}</div>
        <p className="mt-1 text-[15px] text-gray-600">{tr('ملف مضغوط فيه كل شي: قاعدة البيانات، كل الإيصالات، كل الفواتير. حلو تنزّلها مرة بالشهر وتحطها بمكان آمن.')}</p>
        <Button className="mt-4" block loading={busy} onClick={dl} icon={<DatabaseBackup className="size-5" />}>{tr('تحميل نسخة كاملة')}</Button>
      </Card>
    </div>
  );
}

// ───────────── Trash ─────────────
function Trash() {
  const q = useQuery<Entry[]>({ queryKey: ['trash'], queryFn: () => api('/trash') });
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  if (q.isLoading) return <Loading />;
  const restore = async (e: Entry) => {
    await api(`/entries/${e.id}/restore`, { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['month'] });
    toast(tr('رجع الإيصال لمكانو'));
  };
  const purge = async (e: Entry) => {
    if (!(await confirm({ title: tr('حذف نهائي؟'), text: tr('ما في رجعة بعدها.'), confirm: tr('حذف نهائي'), danger: true }))) return;
    await api(`/entries/${e.id}/permanent`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['trash'] });
  };
  const list = q.data || [];
  return list.length === 0 ? (
    <Card><Empty icon={<Trash2 className="size-6" />} title={tr('السلة فاضية')} /></Card>
  ) : (
    <Card className="divide-y divide-gray-100">
      {list.map((e) => (
        <div key={e.id} className="flex items-center gap-2 pe-3">
          <div className="pointer-events-none min-w-0 flex-1 opacity-70"><EntryRow entry={e} /></div>
          <IconButton label={tr('ترجيع')} onClick={() => restore(e)} className="text-emerald-600"><RotateCcw className="size-5" /></IconButton>
          <IconButton label={tr('حذف نهائي')} onClick={() => purge(e)} className="text-red-500"><Trash2 className="size-5" /></IconButton>
        </div>
      ))}
    </Card>
  );
}

// ───────────── Audit log ─────────────
const ACTIONS: Record<string, string> = {
  create: tr('إنشاء|audit'), update: tr('تعديل|audit'), delete: tr('حذف|audit'), issue: tr('إصدار|audit'), paid: tr('تم الدفع|audit'), unpaid: tr('إلغاء الدفع|audit'), cancel: tr('إلغاء فاتورة|audit'), correct: tr('تصحيح|audit'),
  convert: tr('تحويل لفاتورة|audit'), duplicate: tr('نسخ|audit'), trash: tr('نقل للسلة|audit'), restore: tr('ترجيع|audit'), delete_permanent: tr('حذف نهائي|audit'), export: tr('تصدير شهر|audit'), add_files: tr('إضافة ملفات|audit'),
  delete_file: tr('حذف ملف|audit'), logo: tr('رفع لوغو|audit'), logo_delete: tr('حذف لوغو|audit'), counter: tr('تغيير الترقيم|audit'), month_done: tr('إكمال شهر|audit'), month_reopen: tr('فتح شهر|audit'),
  backup_download: tr('تحميل نسخة|audit'), password_change: tr('تغيير كلمة السر|audit'), setup: tr('إنشاء الحساب|audit'), archive: tr('أرشفة|audit'), quote_status: tr('حالة العرض|audit'), decline: tr('رفض عرض|audit'),
};
const ENTITIES: Record<string, string> = { invoice: tr('فاتورة|audit'), quote: tr('عرض|audit'), storno: tr('إلغاء|audit'), entry: tr('إيصال|audit'), client: tr('عميل|audit'), subscription: tr('اشتراك|audit'), settings: tr('إعدادات|audit'), month: tr('شهر|audit'), user: tr('مستخدم|audit'), system: tr('نظام|audit') };
function berlinTime(utc: string) {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
function Audit() {
  const q = useQuery<any[]>({ queryKey: ['audit'], queryFn: () => api('/audit?limit=300') });
  if (q.isLoading) return <Loading />;
  return (
    <Card className="divide-y divide-gray-100">
      {(q.data || []).map((a) => (
        <div key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
          <Pencil className="size-4 shrink-0 text-gray-300" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{ACTIONS[a.action] || a.action}</span> <span className="text-gray-500">{ENTITIES[a.entity] || a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</span>
            {a.user_name && <span className="text-gray-400"> · {a.user_name}</span>}
          </div>
          <span className="num shrink-0 text-xs text-gray-400">{berlinTime(a.at)}</span>
        </div>
      ))}
    </Card>
  );
}
