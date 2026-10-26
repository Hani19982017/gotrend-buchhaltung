import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, FileText, Plus, Users, Settings as SettingsIcon, Camera, Paperclip, PenLine, Receipt, FileSignature, LogOut } from 'lucide-react';
import { cx, Sheet } from './ui';
import { captureStore } from '../lib/captureStore';
import { currentYm, defaultDateFor } from '../lib/format';
import { api } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

const NAV = [
  { to: '/month', label: 'الشهر', icon: CalendarDays },
  { to: '/invoices', label: 'الفواتير', icon: FileText },
  { to: '/clients', label: 'العملاء', icon: Users },
  { to: '/settings', label: 'الإعدادات', icon: SettingsIcon },
];

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <div className="flex size-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(79_70_229/0.7)]">
        <span className="text-lg font-bold leading-none" style={{ fontFamily: 'system-ui' }}>G</span>
        <span className="mb-2 ms-[1px] size-1.5 rounded-full bg-amber-300" />
      </div>
      <div className="leading-tight" dir="ltr">
        <div className="text-[15px] font-bold text-gray-900">Go.Trend</div>
        <div className="text-[11px] font-medium text-gray-500">Buchhaltung</div>
      </div>
    </div>
  );
}

export function useCapture() {
  const nav = useNavigate();
  const loc = useLocation();
  const viewedYm = () => {
    const m = /^\/month\/(\d{4}-\d{2})/.exec(loc.pathname);
    return m ? m[1] : captureStore.ym() || currentYm();
  };
  return {
    openWithFiles(files: File[], params: Record<string, string> = {}) {
      captureStore.set(files);
      const ym = viewedYm();
      nav(`/entry/new?${new URLSearchParams({ date: defaultDateFor(ym), ...params })}`);
    },
    viewedYm,
  };
}

export default function Layout() {
  const [sheet, setSheet] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const capture = useCapture();

  // Always land at the top of a new page
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [loc.pathname]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setSheet(false);
    if (files.length) capture.openWithFiles(files);
  };

  const go = (to: string) => {
    setSheet(false);
    nav(to);
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => null);
    qc.clear();
    window.location.href = '/login';
  };

  const actions = [
    { label: 'صوّر إيصال', sub: 'بالكاميرا فوراً', icon: Camera, color: 'bg-brand-600 text-white', htmlFor: 'gt-cam' },
    { label: 'ارفع ملف', sub: 'صورة أو PDF', icon: Paperclip, color: 'bg-sky-100 text-sky-700', htmlFor: 'gt-file' },
    { label: 'مصروف بدون ملف', sub: 'إدخال يدوي', icon: PenLine, color: 'bg-amber-100 text-amber-700', onClick: () => go(`/entry/new?date=${defaultDateFor(capture.viewedYm())}`) },
    { label: 'فاتورة جديدة', sub: 'لعميل', icon: Receipt, color: 'bg-emerald-100 text-emerald-700', onClick: () => go('/invoices/new') },
    { label: 'عرض سعر', sub: 'Angebot', icon: FileSignature, color: 'bg-violet-100 text-violet-700', onClick: () => go('/invoices/new?kind=quote') },
  ];

  return (
    <div className="min-h-dvh lg:flex">
      <input id="gt-cam" ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
      <input id="gt-file" ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={onPick} />

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-gray-200/70 bg-white/70 px-4 py-6 backdrop-blur lg:flex">
        <NavLink to="/month" className="mb-7 px-2"><Logo /></NavLink>
        <button onClick={() => setSheet(true)} className="group mb-6 flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand-600 font-bold text-white shadow-[0_8px_20px_-8px_rgb(79_70_229/0.7)] transition hover:bg-brand-700 active:scale-[0.97]">
          <Plus className="icon-pop size-5" /> إضافة
        </button>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('group flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100')}>
              <n.icon className="icon-pop size-5" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="group mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-100">
          <LogOut className="icon-pop size-4.5" /> تسجيل خروج
        </button>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-nav sm:px-6 lg:px-10 lg:pt-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-gray-200/70 bg-white/90 backdrop-blur-lg lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2 pt-1.5 pb-1">
          {NAV.slice(0, 2).map((n) => <NavItem key={n.to} {...n} />)}
          <div className="flex justify-center">
            <button aria-label="إضافة" onClick={() => setSheet(true)} className="group -mt-7 flex size-15 items-center justify-center rounded-full bg-brand-600 text-white shadow-[0_10px_24px_-8px_rgb(79_70_229/0.8)] ring-4 ring-white transition active:scale-90">
              <Plus className="icon-pop size-7" strokeWidth={2.5} />
            </button>
          </div>
          {NAV.slice(2).map((n) => <NavItem key={n.to} {...n} />)}
        </div>
      </nav>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="شو بدك تضيف؟">
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {actions.map((a, i) => {
            const inner = (
              <>
                <span className={cx('icon-pop flex size-11 items-center justify-center rounded-2xl', a.color)}><a.icon className="size-5.5" /></span>
                <span className="mt-2 block font-bold text-gray-900">{a.label}</span>
                <span className="block text-xs text-gray-500">{a.sub}</span>
              </>
            );
            const cls = cx('group card card-hover block cursor-pointer p-4 text-start', i === 0 && 'col-span-2 flex items-center gap-3 !bg-brand-50/60');
            return a.htmlFor ? (
              <label key={a.label} htmlFor={a.htmlFor} className={cls}>
                {i === 0 ? (
                  <>
                    <span className={cx('icon-pop flex size-12 shrink-0 items-center justify-center rounded-2xl', a.color)}><a.icon className="size-6" /></span>
                    <span><span className="block text-[17px] font-bold text-gray-900">{a.label}</span><span className="block text-xs text-gray-500">{a.sub} — بينحط بشهرو ومجلدو</span></span>
                  </>
                ) : inner}
              </label>
            ) : (
              <button key={a.label} type="button" onClick={a.onClick} className={cls}>{inner}</button>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <NavLink to={to} className={({ isActive }) => cx('group flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition', isActive ? 'text-brand-600' : 'text-gray-500')}>
      {({ isActive }) => (
        <>
          <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition', isActive && 'bg-brand-50')}>
            <Icon className="icon-pop size-5.5" />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}
