import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronLeft, Receipt, ShoppingBag, Repeat, Wallet, Landmark, CheckCircle2, Circle, Download, Share2,
  AlertTriangle, PackageCheck, Upload, CalendarCheck2, FileText, TrendingUp, TrendingDown,
} from 'lucide-react';
import { api, apiBlob, downloadFrom, shareBlob } from '../lib/api';
import type { MonthData } from '../lib/types';
import { fmtEur, shiftYm, ymLabel, currentYm, fmtDate, clientName, defaultDateFor } from '../lib/format';
import { captureStore } from '../lib/captureStore';
import { Button, Card, Loading, ErrorBox, Money, Section, Sheet, cx, useAsync, useUi, Badge } from '../components/ui';
import { tr } from '../lib/i18n';

export default function MonthPage() {
  const { ym = currentYm() } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<MonthData>({ queryKey: ['month', ym], queryFn: () => api(`/months/${ym}`) });
  const [exportOpen, setExportOpen] = useState(false);
  const { run, busy } = useAsync();

  useEffect(() => captureStore.setYm(ym), [ym]);

  const [y, m] = ym.split('-');
  const isCurrent = ym === currentYm();

  const header = (
    <div className="mb-5 flex items-center justify-between gap-2">
      <button aria-label={tr('الشهر السابق')} onClick={() => nav(`/month/${shiftYm(ym, -1)}`)} className="group flex size-11 items-center justify-center rounded-2xl bg-white text-gray-700 shadow-[var(--shadow-card)] transition active:scale-90">
        <ChevronRight className="flip-ltr icon-pop size-5.5" />
      </button>
      <div className="text-center">
        <div className="text-[22px] font-bold leading-tight text-gray-900">{ymLabel(ym)}</div>
        <div className="text-xs font-semibold text-gray-500">
          {tr('شهر')} <span className="num">{Number(m)}</span> · <span className="num">{y}</span>
          {!isCurrent && (
            <button onClick={() => nav(`/month/${currentYm()}`)} className="ms-2 text-brand-600 underline-offset-2 hover:underline">{tr('رجوع للشهر الحالي')}</button>
          )}
        </div>
      </div>
      <button aria-label={tr('الشهر الجاي')} onClick={() => nav(`/month/${shiftYm(ym, 1)}`)} className="group flex size-11 items-center justify-center rounded-2xl bg-white text-gray-700 shadow-[var(--shadow-card)] transition active:scale-90">
        <ChevronLeft className="flip-ltr icon-pop size-5.5" />
      </button>
    </div>
  );

  const strip = <YearStrip ym={ym} />;
  if (isLoading) return <>{header}{strip}<Loading /></>;
  if (error || !data) return <>{header}{strip}<ErrorBox error={error} /></>;

  const t = data.totals;
  const c = data.checks;
  const subsDone = data.subscriptions.filter((s) => s.entry_id && s.has_file).length;
  const checklist = [
    { ok: c.missingFiles === 0, label: c.missingFiles === 0 ? tr('كل المصاريف إلها إيصال') : tr('{0} مصروف بدون إيصال', [c.missingFiles]), to: firstMissing(data) },
    ...(data.subscriptions.length ? [{ ok: c.missingSubs === 0, label: tr('إيصالات الاشتراكات {0}/{1}', [subsDone, data.subscriptions.length]), to: '#subs' }] : []),
    { ok: c.bankStatement, label: c.bankStatement ? tr('كشف الحساب مرفوع') : tr('كشف حساب البنك لسا ما انرفع'), to: c.bankStatement ? `/month/${ym}/bank` : `/entry/new?folder=bank&date=${defaultDateFor(ym)}` },
    { ok: c.drafts === 0, label: c.drafts === 0 ? tr('ما في فواتير مسودة') : tr('{0} فاتورة مسودة لسا ما صدرت', [c.drafts]), to: '/invoices?tab=draft' },
  ];
  const done = checklist.filter((x) => x.ok).length;
  const pct = Math.round((done / checklist.length) * 100);

  const folders = [
    { key: 'invoices', label: tr('فواتير العملاء'), icon: Receipt, color: 'from-emerald-500 to-emerald-600', count: data.invoices.length + data.entries.income.length, cents: t.income_cents, warn: data.entries.income.filter((e) => !e.files.length).length },
    { key: 'purchase', label: tr('المشتريات'), icon: ShoppingBag, color: 'from-amber-400 to-orange-500', count: data.entries.purchase.length, cents: t.purchase_cents, warn: data.entries.purchase.filter((e) => !e.files.length).length },
    { key: 'subscription', label: tr('الاشتراكات'), icon: Repeat, color: 'from-violet-500 to-purple-600', count: data.entries.subscription.length, cents: t.subscription_cents, warn: data.entries.subscription.filter((e) => !e.files.length).length },
    { key: 'other', label: tr('مصاريف تانية'), icon: Wallet, color: 'from-sky-500 to-blue-600', count: data.entries.other.length, cents: t.other_cents, warn: data.entries.other.filter((e) => !e.files.length).length },
    { key: 'bank', label: tr('كشف البنك'), icon: Landmark, color: 'from-slate-500 to-slate-700', count: data.entries.bank.length, cents: null, warn: 0 },
  ];

  const toggleDone = () => run(async () => {
    await api(`/months/${ym}/done`, { body: { done: !data.done_at } });
    qc.invalidateQueries({ queryKey: ['month', ym] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  }, data.done_at ? tr('رجع الشهر مفتوح') : tr('تمام! الشهر مكتمل'));

  return (
    <div className="animate-fade-up">
      {header}
      {strip}

      {/* Totals */}
      <Card className="relative mb-4 overflow-hidden p-5">
        <div className="pointer-events-none absolute -top-16 -start-16 size-44 rounded-full bg-brand-100/60" />
        <div className="relative">
          <div className="text-sm font-semibold text-gray-500">{tr('الصافي لهالشهر')}</div>
          <Money cents={t.profit_cents} className={cx('mt-1 block text-[34px] font-bold leading-tight', t.profit_cents < 0 ? 'text-red-600' : 'text-gray-900')} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><TrendingUp className="size-4" /> {tr('الدخل')}</div>
              <Money cents={t.income_cents} className="mt-0.5 block text-lg font-bold text-emerald-800" />
            </div>
            <div className="rounded-2xl bg-rose-50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700"><TrendingDown className="size-4" /> {tr('المصاريف')}</div>
              <Money cents={t.expenses_cents} className="mt-0.5 block text-lg font-bold text-rose-800" />
            </div>
          </div>
        </div>
      </Card>

      {/* Readiness */}
      <Card className="mb-6 p-5">
        <div className="flex items-center gap-4">
          <ProgressRing pct={pct} done={!!data.done_at} />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-gray-900">{data.done_at ? tr('الشهر مكتمل ✓') : pct === 100 ? tr('الشهر جاهز للمحاسب') : tr('جاهزية الشهر')}</div>
            <div className="text-sm text-gray-500">
              {data.exported_at ? tr('آخر تصدير: {0}', [fmtDate(data.exported_at)]) : tr('لما يكمل، صدّرو بكبسة وحدة')}
            </div>
          </div>
        </div>
        <ul className="mt-4 space-y-1">
          {checklist.map((x) => (
            <li key={x.label}>
              <Link to={x.to} onClick={(e) => { if (x.to.startsWith('#')) { e.preventDefault(); document.querySelector(x.to)?.scrollIntoView({ behavior: 'smooth' }); } }}
                className="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[14px] transition hover:bg-gray-50">
                {x.ok ? <CheckCircle2 className="icon-pop size-5 shrink-0 text-emerald-500" /> : <Circle className="icon-pop size-5 shrink-0 text-amber-500" />}
                <span className={x.ok ? 'text-gray-600' : 'font-semibold text-gray-900'}>{x.label}</span>
                {!x.ok && <ChevronLeft className="flip-ltr ms-auto size-4 text-gray-400" />}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button block icon={<PackageCheck className="size-5" />} onClick={() => setExportOpen(true)}>{tr('تصدير للمحاسب')}</Button>
          <Button variant={data.done_at ? 'secondary' : 'soft'} loading={busy} onClick={toggleDone} icon={<CalendarCheck2 className="size-5" />} className="shrink-0">
            {data.done_at ? tr('افتح') : tr('مكتمل')}
          </Button>
        </div>
      </Card>

      {/* Folders */}
      <Section title={tr('مجلدات الشهر')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {folders.map((f) => (
            <Link key={f.key} to={`/month/${ym}/${f.key}`} className="group card card-hover relative p-4">
              <div className={cx('icon-pop mb-3 flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md', f.color)}>
                <f.icon className="size-5.5" />
              </div>
              <div className="font-bold text-gray-900">{f.label}</div>
              <div className="mt-0.5 flex items-center justify-between gap-1 text-sm text-gray-500">
                <span><span className="num">{f.count}</span> {f.count === 1 ? tr('ملف') : tr('ملفات')}</span>
                {f.cents !== null && <Money cents={f.cents} className="font-semibold text-gray-700" />}
              </div>
              {f.warn > 0 && (
                <span className="absolute top-3 end-3 flex size-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-white shadow" title={tr('بدون إيصال')}>
                  {f.warn}
                </span>
              )}
            </Link>
          ))}
        </div>
      </Section>

      {/* Subscriptions checklist */}
      <Section title={tr('الاشتراكات الثابتة لهالشهر')} action={<Link to="/settings/subscriptions" className="text-sm font-semibold text-brand-600">{tr('إدارة')}</Link>}>
        <div id="subs" className="scroll-mt-4" />
        {data.subscriptions.length === 0 ? (
          <Card className="p-4 text-sm text-gray-600">
            {tr('عرّف اشتراكاتك الثابتة مرة وحدة (كلاود، برامج، إيجار، هاتف) والبرنامج بيذكّرك كل شهر بالإيصالات الناقصة.')}
            <Link to="/settings/subscriptions" className="mt-2 block font-semibold text-brand-600">{tr('+ أضف اشتراك')}</Link>
          </Card>
        ) : (
          <Card className="divide-y divide-gray-100">
            {data.subscriptions.map((s) => {
              const ok = s.entry_id && s.has_file;
              return (
                <div key={s.id} className="flex items-center gap-3 p-3.5">
                  {ok ? <CheckCircle2 className="size-5.5 shrink-0 text-emerald-500" /> : <Circle className="size-5.5 shrink-0 text-gray-300" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-500"><Money cents={s.amount_cents} /> {s.vendor && `· ${s.vendor}`}</div>
                  </div>
                  {ok ? (
                    <Link to={`/entry/${s.entry_id}`} className="text-sm font-semibold text-gray-500">{tr('عرض')}</Link>
                  ) : s.entry_id ? (
                    <Button size="sm" variant="soft" onClick={() => nav(`/entry/${s.entry_id}`)} icon={<Upload className="size-4" />}>{tr('إيصال')}</Button>
                  ) : (
                    <Button size="sm" variant="soft" icon={<Upload className="size-4" />} onClick={() => nav(`/entry/new?${new URLSearchParams({ folder: s.folder, sub: String(s.id), vendor: s.vendor || s.name, amount: String(s.amount_cents), method: s.payment_method, desc: s.name, date: defaultDateFor(ym) })}`)}>
                      {tr('ارفع')}
                    </Button>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </Section>

      {/* Open invoices */}
      {data.openInvoices.length > 0 && (
        <Section title={tr('فواتير بانتظار الدفع')} action={<Link to="/invoices?tab=open" className="text-sm font-semibold text-brand-600">{tr('الكل')}</Link>}>
          <Card className="divide-y divide-gray-100">
            {data.openInvoices.slice(0, 6).map((i) => (
              <Link key={i.id} to={`/invoices/${i.id}`} className="flex items-center gap-3 p-3.5 transition hover:bg-gray-50">
                <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', i.overdue ? 'bg-amber-50 text-amber-600' : 'bg-sky-50 text-sky-600')}>
                  {i.overdue ? <AlertTriangle className="size-5" /> : <FileText className="size-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-gray-900">{clientName(i.client)}</div>
                  <div className="text-xs text-gray-500"><span className="num">{i.number}</span> · {i.overdue ? <span className="font-semibold text-amber-700">{tr('متأخرة من')} {fmtDate(i.due_date)}</span> : tr('مستحقة {0}', [fmtDate(i.due_date)])}</div>
                </div>
                <Money cents={i.total_cents} className="font-bold text-gray-900" />
              </Link>
            ))}
          </Card>
        </Section>
      )}

      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} data={data} />
    </div>
  );
}

function firstMissing(d: MonthData) {
  for (const f of ['purchase', 'subscription', 'other', 'income'] as const) {
    const e = d.entries[f].find((x) => !x.files.length);
    if (e) return `/entry/${e.id}`;
  }
  return `/month/${d.ym}/purchase`;
}

function ProgressRing({ pct, done }: { pct: number; done: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const color = done || pct === 100 ? '#10b981' : '#4f46e5';
  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#eef2f7" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <span className="num absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-800">{pct}%</span>
    </div>
  );
}

function ExportSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: MonthData }) {
  const { run, busy } = useAsync();
  const { toast } = useUi();
  const qc = useQueryClient();
  const warnings: string[] = [];
  if (data.checks.missingFiles) warnings.push(tr('{0} مصروف بدون إيصال', [data.checks.missingFiles]));
  if (data.checks.missingSubs) warnings.push(tr('{0} اشتراك بدون إيصال', [data.checks.missingSubs]));
  if (!data.checks.bankStatement) warnings.push(tr('كشف الحساب ناقص'));
  if (data.checks.drafts) warnings.push(tr('{0} فاتورة مسودة (ما رح تنضاف)', [data.checks.drafts]));
  const fileCount = data.invoices.length + Object.values(data.entries).reduce((s, l) => s + l.reduce((a, e) => a + e.files.length, 0), 0);

  const download = () => run(async () => {
    await downloadFrom(`/months/${data.ym}/export`, `GoTrend_Buchhaltung_${data.ym}.zip`);
    qc.invalidateQueries({ queryKey: ['month', data.ym] });
  }, tr('تم تحميل ملف الشهر'));

  const share = () => run(async () => {
    const blob = await apiBlob(`/months/${data.ym}/export`);
    const r = await shareBlob(blob, `GoTrend_Buchhaltung_${data.ym}.zip`, `Buchhaltung ${data.ym}`);
    if (r === 'downloaded') toast(tr('جهازك ما بيدعم المشاركة المباشرة، فنزّلت الملف'), 'info');
    qc.invalidateQueries({ queryKey: ['month', data.ym] });
  });

  return (
    <Sheet open={open} onClose={onClose} title={tr('تصدير {0}', [ymLabel(data.ym)])}
      footer={
        <div className="flex gap-2">
          <Button block loading={busy} onClick={download} icon={<Download className="size-5" />}>{tr('تحميل الملف')}</Button>
          <Button variant="secondary" loading={busy} onClick={share} icon={<Share2 className="size-5" />} className="shrink-0">{tr('مشاركة')}</Button>
        </div>
      }>
      <p className="text-[15px] text-gray-600">{tr('ملف مضغوط واحد مرتب بمجلدات، جاهز تبعتو للمستشار الضريبي:')}</p>
      <ul className="mt-3 space-y-1.5 rounded-2xl bg-gray-50 p-4 text-sm text-gray-700" dir="ltr">
        <li>📄 00_Monatsuebersicht.pdf</li>
        <li>📊 00_Buchungsliste.csv</li>
        <li>📁 01_Ausgangsrechnungen <span className="text-gray-400">({data.invoices.length + data.entries.income.length})</span></li>
        <li>📁 02_Einkaeufe <span className="text-gray-400">({data.entries.purchase.length})</span></li>
        <li>📁 03_Abonnements_Fixkosten <span className="text-gray-400">({data.entries.subscription.length})</span></li>
        <li>📁 04_Sonstige_Ausgaben <span className="text-gray-400">({data.entries.other.length})</span></li>
        <li>📁 05_Kontoauszug <span className="text-gray-400">({data.entries.bank.length})</span></li>
      </ul>
      <div className="mt-3 text-sm text-gray-500"><span className="num">{fileCount}</span> {tr('ملف · الدخل')} <Money cents={data.totals.income_cents} className="font-semibold text-gray-700" /> {tr('· المصاريف')} <Money cents={data.totals.expenses_cents} className="font-semibold text-gray-700" /></div>
      {warnings.length > 0 && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle className="size-4" /> {tr('انتبه قبل ما تبعت')}</div>
          <ul className="list-inside list-disc space-y-0.5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <div className="mt-1.5 text-xs text-amber-800">{tr('فيك تصدّر هلق كمان، والنواقص مكتوبة بالملخص للمحاسب.')}</div>
        </div>
      )}
      {data.done_at && <Badge tone="green" className="mt-3">{tr('الشهر محدد كمكتمل')}</Badge>}
    </Sheet>
  );
}

function YearStrip({ ym }: { ym: string }) {
  const year = ym.slice(0, 4);
  const nav = useNavigate();
  const { data } = useQuery<{ ym: string; income_cents: number; expenses_cents: number; entries: number; done_at: string | null; exported_at: string | null }[]>({
    queryKey: ['month', 'overview', year], queryFn: () => api(`/overview?year=${year}`), staleTime: 30_000,
  });
  const now = currentYm();
  return (
    <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none sm:gap-1.5" aria-label={tr('شهور السنة')}>
      {Array.from({ length: 12 }, (_, i) => {
        const m = `${year}-${String(i + 1).padStart(2, '0')}`;
        const info = data?.find((x) => x.ym === m);
        const active = m === ym;
        const has = !!info && (info.entries > 0 || info.income_cents !== 0);
        return (
          <button key={m} onClick={() => nav(`/month/${m}`)} aria-label={ymLabel(m)} aria-current={active ? 'date' : undefined}
            className={cx('relative flex h-9 min-w-[1.6rem] flex-1 items-center justify-center rounded-xl text-[13px] font-bold transition active:scale-90 sm:h-10 sm:text-sm',
              active ? 'bg-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(79_70_229/0.7)]' : info?.done_at ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-gray-600 shadow-[var(--shadow-card)]',
              m === now && !active && 'ring-2 ring-brand-200', m > now && !active && 'opacity-50')}>
            <span className="num">{i + 1}</span>
            {info?.done_at ? (
              <CheckCircle2 className={cx('absolute -top-1 -end-1 size-3.5 rounded-full bg-white', active ? 'text-emerald-500' : 'text-emerald-500')} />
            ) : has ? (
              <span className={cx('absolute bottom-1 size-1 rounded-full', active ? 'bg-white' : 'bg-brand-500')} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
