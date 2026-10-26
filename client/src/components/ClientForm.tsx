import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Client } from '../lib/types';
import { Button, Field, Sheet, Segmented, useUi } from './ui';
import { tr } from '../lib/i18n';

const empty = { company: '', contact: '', street: '', zip: '', city: '', country: 'Deutschland', email: '', phone: '', vat_id: '', payment_days: '', language: 'de' as 'de' | 'en', notes: '' };

export default function ClientForm({ open, onClose, client, onSaved }: { open: boolean; onClose: () => void; client?: Client | null; onSaved?: (id: number) => void }) {
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setF(client ? {
      company: client.company, contact: client.contact, street: client.street, zip: client.zip, city: client.city, country: client.country || 'Deutschland',
      email: client.email, phone: client.phone, vat_id: client.vat_id, payment_days: client.payment_days == null ? '' : String(client.payment_days), language: client.language, notes: client.notes,
    } : empty);
  }, [open, client]);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (!f.company.trim() && !f.contact.trim()) return toast(tr('اكتب اسم الشركة أو اسم الشخص'), 'error');
    setBusy(true);
    try {
      const body = { ...f, payment_days: f.payment_days === '' ? null : Number(f.payment_days) };
      let id = client?.id;
      if (client) await api(`/clients/${client.id}`, { method: 'PUT', body });
      else id = (await api<{ id: number }>('/clients', { body })).id;
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client', String(id)] });
      toast(client ? tr('انحفظ العميل') : tr('انضاف العميل'));
      onSaved?.(id!);
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={client ? tr('تعديل العميل') : tr('عميل جديد')} wide
      footer={<Button block size="lg" loading={busy} onClick={save}>{client ? tr('حفظ') : tr('إضافة العميل')}</Button>}>
      <div className="grid grid-cols-1 gap-3.5 pt-1 sm:grid-cols-2">
        <Field label={tr('اسم الشركة')} className="sm:col-span-2"><input className="field" dir="auto" value={f.company} onChange={set('company')} placeholder="Firma GmbH" autoFocus /></Field>
        <Field label={tr('الشخص المسؤول')}><input className="field" dir="auto" value={f.contact} onChange={set('contact')} placeholder="Herr / Frau …" /></Field>
        <Field label={tr('الإيميل')}><input className="field" dir="ltr" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label={tr('الشارع ورقم البناية')} className="sm:col-span-2"><input className="field" dir="auto" value={f.street} onChange={set('street')} placeholder="Musterstraße 1" /></Field>
        <div className="grid grid-cols-[7rem_1fr] gap-3 sm:col-span-2">
          <Field label={tr('الرمز البريدي')}><input className="field num" inputMode="numeric" value={f.zip} onChange={set('zip')} /></Field>
          <Field label={tr('المدينة')}><input className="field" dir="auto" value={f.city} onChange={set('city')} /></Field>
        </div>
        <Field label={tr('البلد')}><input className="field" dir="auto" value={f.country} onChange={set('country')} /></Field>
        <Field label={tr('الهاتف')}><input className="field" dir="ltr" type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label={tr('الرقم الضريبي للعميل')} hint={tr('مهم إذا العميل شركة بدولة أوروبية تانية')}><input className="field" dir="ltr" value={f.vat_id} onChange={set('vat_id')} placeholder="DE123456789" /></Field>
        <Field label={tr('مهلة الدفع (أيام)')} hint={tr('فاضي = الافتراضي من الإعدادات')}><input className="field num" inputMode="numeric" value={f.payment_days} onChange={set('payment_days')} placeholder="14" /></Field>
        <Field label={tr('لغة الفواتير')} className="sm:col-span-2" group>
          <Segmented value={f.language} onChange={(v) => setF({ ...f, language: v })} options={[{ value: 'de', label: tr('ألماني') }, { value: 'en', label: tr('إنكليزي') }]} />
        </Field>
        <Field label={tr('ملاحظات')} className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Sheet>
  );
}
