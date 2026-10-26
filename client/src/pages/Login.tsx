import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Field, ErrorBox } from '../components/ui';
import { Logo } from '../components/Layout';

export default function Login({ state, onDone }: { state: { setupNeeded: boolean; setupCodeRequired: boolean }; onDone: () => void }) {
  const setup = state?.setupNeeded;
  const [f, setF] = useState({ name: '', email: '', password: '', password2: '', setupCode: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (setup && f.password !== f.password2) return setErr(new Error('كلمتين السر مو متطابقين'));
    setBusy(true);
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { body: f });
      onDone();
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-canvas px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 animate-fade-up">
        <Logo className="mb-6" />
        <h1 className="text-xl font-bold">{setup ? 'إنشاء الحساب' : 'أهلاً فيك'}</h1>
        <p className="mb-5 mt-1 text-sm text-gray-500">{setup ? 'أول مرة؟ اعمل حسابك لتبلّش. بيانات الشركة محمية بكلمة سر.' : 'سجّل دخول لتكمل.'}</p>
        <div className="space-y-3.5">
          {setup && (
            <Field label="الاسم">
              <input className="field" value={f.name} onChange={set('name')} autoComplete="name" required />
            </Field>
          )}
          <Field label="الإيميل">
            <input className="field" type="email" dir="ltr" value={f.email} onChange={set('email')} autoComplete="username" required />
          </Field>
          <Field label="كلمة السر" hint={setup ? '٨ أحرف على الأقل' : undefined}>
            <input className="field" type="password" dir="ltr" value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 8 : undefined} />
          </Field>
          {setup && (
            <Field label="أعد كلمة السر">
              <input className="field" type="password" dir="ltr" value={f.password2} onChange={set('password2')} autoComplete="new-password" required />
            </Field>
          )}
          {setup && state.setupCodeRequired && (
            <Field label="رمز الإعداد" hint="موجود بإعدادات الخادم على Render باسم SETUP_CODE">
              <input className="field" dir="ltr" value={f.setupCode} onChange={set('setupCode')} required />
            </Field>
          )}
          {err ? <ErrorBox error={err} /> : null}
          <Button type="submit" block size="lg" loading={busy} icon={<Lock className="size-4.5" />}>{setup ? 'إنشاء الحساب' : 'دخول'}</Button>
        </div>
      </form>
    </div>
  );
}
