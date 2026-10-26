import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, X, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { fmtEur } from '../lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ───────────── Buttons ─────────────
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'soft';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  block?: boolean;
};
export function Button({ variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-[0_6px_16px_-6px_rgb(79_70_229/0.6)]',
    secondary: 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50',
    ghost: 'text-gray-700 hover:bg-gray-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-[0_6px_16px_-6px_rgb(5_150_105/0.6)]',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  }[variant];
  const sizes = { sm: 'h-9 px-3 text-sm rounded-xl gap-1.5', md: 'h-11 px-4 text-[15px] rounded-2xl gap-2', lg: 'h-13 px-5 text-base rounded-2xl gap-2' }[size];
  return (
    <button
      className={cx('group inline-flex items-center justify-center font-semibold transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none select-none', styles, sizes, block && 'w-full', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4.5 animate-spin" /> : icon ? <span className="icon-pop inline-flex">{icon}</span> : null}
      {children}
    </button>
  );
}

export function IconButton({ className, label, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx('group inline-flex size-10 items-center justify-center rounded-xl text-gray-600 transition hover:bg-gray-100 active:scale-90', className)} {...rest}>
      <span className="icon-pop inline-flex">{children}</span>
    </button>
  );
}

// ───────────── Layout bits ─────────────
export function PageHeader({ title, subtitle, back, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; back?: string | boolean; actions?: React.ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="mb-5 flex items-start gap-2">
      {back && (
        <IconButton label="رجوع" className="-ms-2 mt-0.5 shrink-0" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
          <ArrowRight className="size-5" />
        </IconButton>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[22px] font-bold leading-tight text-gray-900 lg:text-2xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-gray-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', className)} {...rest}>{children}</div>;
}

export function Section({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('mb-6', className)}>
      {(title || action) && (
        <div className="mb-2.5 flex items-center justify-between px-1">
          <h2 className="text-[15px] font-bold text-gray-800">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, className, group }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return (
    <div className={cx('block', className)} role={group ? 'group' : undefined}>
      <Tag className="block">
        {label && <span className="mb-1.5 block text-[13px] font-semibold text-gray-700">{label}</span>}
        {children}
      </Tag>
      {hint && !error && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function Money({ cents, className, sign }: { cents: number; className?: string; sign?: boolean }) {
  const s = fmtEur(cents);
  return <span className={cx('num', className)}>{sign && cents > 0 ? '+' : ''}{s}</span>;
}

export function Badge({ tone = 'gray', children, className }: { tone?: 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'violet'; children: React.ReactNode; className?: string }) {
  const t = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-sky-50 text-sky-700 ring-sky-600/15',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
    red: 'bg-red-50 text-red-700 ring-red-600/15',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    violet: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-transparent ring-inset', t, className)}>{children}</span>;
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto rounded-2xl bg-gray-100 p-1 scrollbar-none', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 whitespace-nowrap rounded-xl font-semibold transition',
            size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm',
            value === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            'group inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition active:scale-95',
            value === o.value ? 'border-brand-600 bg-brand-600 text-white shadow-[0_4px_12px_-4px_rgb(79_70_229/0.6)]' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
          )}
        >
          {o.icon && <span className="icon-pop inline-flex">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-6 animate-spin text-brand-600', className)} />;
}

export function Loading({ label = 'لحظة…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">{icon}</div>}
      <div className="font-bold text-gray-800">{title}</div>
      {text && <p className="mt-1 max-w-xs text-sm text-gray-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = (error as any)?.message || 'صار خطأ';
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

// ───────────── Sheet / Modal ─────────────
export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px] animate-[fade-up_0.2s_ease_both]" onClick={onClose} />
      <div className={cx('relative flex max-h-[92dvh] w-full flex-col rounded-t-[1.75rem] bg-white shadow-2xl animate-sheet lg:max-h-[86vh] lg:rounded-[1.75rem] lg:animate-pop', wide ? 'lg:max-w-2xl' : 'lg:max-w-lg')}>
        <div className="mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-gray-200 lg:hidden" />
        {title && (
          <div className="flex items-center justify-between px-5 pb-2 pt-3 lg:pt-5">
            <h3 className="text-lg font-bold">{title}</h3>
            <IconButton label="إغلاق" onClick={onClose} className="-me-2">
              <X className="size-5" />
            </IconButton>
          </div>
        )}
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="safe-bottom border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ───────────── Toasts & confirm ─────────────
type Toast = { id: number; text: string; tone: 'success' | 'error' | 'info' };
type ConfirmOpts = { title: string; text?: React.ReactNode; confirm?: string; cancel?: string; danger?: boolean; input?: { label: string; placeholder?: string; required?: boolean } };
type UiCtx = { toast: (text: string, tone?: Toast['tone']) => void; confirm: (o: ConfirmOpts) => Promise<false | string> };
const Ctx = createContext<UiCtx>(null as any);
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: false | string) => void }) | null>(null);
  const [inputVal, setInputVal] = useState('');
  const idRef = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5000 : 3000);
  }, []);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<false | string>((resolve) => { setInputVal(''); setDlg({ ...o, resolve }); }), []);
  const close = (v: false | string) => { dlg?.resolve(v); setDlg(null); };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg animate-pop',
            t.tone === 'success' && 'bg-gray-900 text-white', t.tone === 'error' && 'bg-red-600 text-white', t.tone === 'info' && 'bg-white text-gray-900 ring-1 ring-gray-200')}>
            {t.tone === 'success' ? <Check className="size-4.5 shrink-0 text-emerald-400" /> : t.tone === 'error' ? <AlertTriangle className="size-4.5 shrink-0" /> : <Info className="size-4.5 shrink-0 text-brand-600" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <Sheet open={!!dlg} onClose={() => close(false)} title={dlg?.title}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => close(false)}>{dlg?.cancel || 'إلغاء'}</Button>
            <Button variant={dlg?.danger ? 'danger' : 'primary'} block disabled={!!dlg?.input?.required && !inputVal.trim()} onClick={() => close(inputVal.trim() || 'ok')}>{dlg?.confirm || 'تأكيد'}</Button>
          </div>
        }>
        {dlg?.text && <div className="text-[15px] leading-relaxed text-gray-600">{dlg.text}</div>}
        {dlg?.input && (
          <Field label={dlg.input.label} className="mt-4">
            <input autoFocus className="field" placeholder={dlg.input.placeholder} value={inputVal} onChange={(e) => setInputVal(e.target.value)} />
          </Field>
        )}
      </Sheet>
    </Ctx.Provider>
  );
}

export function useAsync() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e: any) {
      toast(e?.message || 'صار خطأ', 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}
