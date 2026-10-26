import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import Login from './pages/Login';
import MonthPage from './pages/Month';
import FolderPage from './pages/Folder';
import EntryPage from './pages/Entry';
import InvoicesPage from './pages/Invoices';
import ClientsPage from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import SettingsPage from './pages/Settings';
import { currentYm } from './lib/format';
import { tr } from './lib/i18n';

const InvoiceEditor = lazy(() => import('./pages/InvoiceEditor'));
const InvoiceView = lazy(() => import('./pages/InvoiceView'));
const SettingsSection = lazy(() => import('./pages/SettingsSections'));

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => api('/auth/state'), staleTime: 60_000 });

  useEffect(() => {
    const h = () => auth.refetch();
    window.addEventListener('gt:unauthorized', h);
    return () => window.removeEventListener('gt:unauthorized', h);
  }, [auth]);

  useEffect(() => {
    if (!auth.data) return;
    const isAuthPage = loc.pathname === '/login';
    if (!auth.data.user && !isAuthPage) nav('/login', { replace: true });
    if (auth.data.user && isAuthPage) nav('/month', { replace: true });
  }, [auth.data, loc.pathname, nav]);

  if (auth.isLoading) return <Loading />;
  if (auth.isError) return <div className="p-6 text-center text-red-600">{tr('ما قدرت اتصل بالخادم. جرّب تحدّث الصفحة.')}</div>;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login state={auth.data} onDone={() => auth.refetch()} />} />
        {auth.data?.user && (
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/month" replace />} />
            <Route path="/month" element={<Navigate to={`/month/${currentYm()}`} replace />} />
            <Route path="/month/:ym" element={<MonthPage />} />
            <Route path="/month/:ym/:folder" element={<FolderPage />} />
            <Route path="/entry/new" element={<EntryPage />} />
            <Route path="/entry/:id" element={<EntryPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/invoices/new" element={<InvoiceEditor />} />
            <Route path="/invoices/:id" element={<InvoiceView />} />
            <Route path="/invoices/:id/edit" element={<InvoiceEditor />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/settings" element={<SettingsPage user={auth.data.user} />} />
            <Route path="/settings/:section" element={<SettingsSection />} />
            <Route path="*" element={<Navigate to="/month" replace />} />
          </Route>
        )}
        <Route path="*" element={<Loading />} />
      </Routes>
    </Suspense>
  );
}
