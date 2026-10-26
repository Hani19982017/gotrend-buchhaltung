import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { UiProvider } from './components/ui';
import './index.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (count, err: any) => err?.status !== 401 && err?.status !== 404 && count < 2, refetchOnWindowFocus: true },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <UiProvider>
          <App />
        </UiProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));
}
