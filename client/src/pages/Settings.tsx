import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, Palette, Percent, Repeat, UserCog, DatabaseBackup, Trash2, History, ChevronLeft, LogOut, Languages } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { Card, PageHeader, cx, LanguageSwitch } from '../components/ui';
import { tr } from '../lib/i18n';

export const SECTIONS = [
  { key: 'company', label: tr('بيانات الشركة والبنك'), sub: tr('الاسم، العنوان، الرقم الضريبي، الآيبان'), icon: Building2, color: 'bg-brand-50 text-brand-600' },
  { key: 'design', label: tr('تصميم الفاتورة'), sub: tr('اللوغو، الألوان، القالب، النصوص'), icon: Palette, color: 'bg-pink-50 text-pink-600' },
  { key: 'tax', label: tr('الضريبة والترقيم'), sub: tr('ضريبة المبيعات، أرقام الفواتير'), icon: Percent, color: 'bg-emerald-50 text-emerald-600' },
  { key: 'subscriptions', label: tr('الاشتراكات الثابتة'), sub: tr('تذكير شهري بالإيصالات'), icon: Repeat, color: 'bg-violet-50 text-violet-600' },
  { key: 'account', label: tr('الحساب والمستخدمين'), sub: tr('كلمة السر، إضافة شخص تاني'), icon: UserCog, color: 'bg-sky-50 text-sky-600' },
  { key: 'backup', label: tr('النسخ الاحتياطي'), sub: tr('نسخة كاملة من كل البيانات'), icon: DatabaseBackup, color: 'bg-amber-50 text-amber-600' },
  { key: 'trash', label: tr('سلة المحذوفات'), sub: tr('رجّع إيصال انحذف بالغلط'), icon: Trash2, color: 'bg-red-50 text-red-600' },
  { key: 'audit', label: tr('سجل التغييرات'), sub: tr('مين عمل شو وإيمتى'), icon: History, color: 'bg-gray-100 text-gray-600' },
];

export default function SettingsPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => null);
    qc.clear();
    window.location.href = '/login';
  };
  return (
    <div className="animate-fade-up">
      <PageHeader title={tr('الإعدادات')} subtitle={<>{tr('مسجّل باسم')} <b>{user.name}</b></>} />
      <Card className="mb-4 flex flex-wrap items-center gap-3.5 p-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600"><Languages className="size-5.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-gray-900">{tr('لغة البرنامج')}</span>
          <span className="block text-sm text-gray-500" dir="ltr">اللغة · Sprache</span>
        </span>
        <LanguageSwitch className="w-full sm:w-auto" />
      </Card>
      <Card className="divide-y divide-gray-100">
        {SECTIONS.map((s) => (
          <Link key={s.key} to={`/settings/${s.key}`} className="group flex items-center gap-3.5 p-4 transition hover:bg-gray-50">
            <span className={cx('icon-pop flex size-11 shrink-0 items-center justify-center rounded-2xl', s.color)}><s.icon className="size-5.5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-gray-900">{s.label}</span>
              <span className="block truncate text-sm text-gray-500">{s.sub}</span>
            </span>
            <ChevronLeft className="flip-ltr size-5 text-gray-300" />
          </Link>
        ))}
      </Card>
      <button onClick={logout} className="group mx-auto mt-6 flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-gray-500 hover:bg-gray-100 lg:hidden">
        <LogOut className="icon-pop size-4.5" /> {tr('تسجيل خروج')}
      </button>
    </div>
  );
}
