import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

if (typeof window !== 'undefined') {
  const smokeCallbackUrl = new URL(window.location.href).searchParams.get('smokeCallback');
  if (smokeCallbackUrl) {
    const postSmokePayload = (payload: Record<string, unknown>) => {
      const text = JSON.stringify(payload);
      const blob = new Blob([text], { type: 'text/plain;charset=UTF-8' });
      if (!navigator.sendBeacon?.(smokeCallbackUrl, blob)) {
        void fetch(smokeCallbackUrl, { method: 'POST', mode: 'no-cors', body: blob });
      }
    };
    window.addEventListener('error', (event) => {
      postSmokePayload({
        phase: 'bootstrap-error',
        status: 'App bootstrap failed.',
        error: event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message ?? 'Unknown error'),
        stack: event.error instanceof Error ? event.error.stack ?? '' : '',
        loaded: false,
        rendered: false,
        ready: false,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason ?? 'Unknown rejection');
      postSmokePayload({
        phase: 'bootstrap-rejection',
        status: 'App bootstrap rejected.',
        error: reason,
        stack: event.reason instanceof Error ? event.reason.stack ?? '' : '',
        loaded: false,
        rendered: false,
        ready: false,
      });
    });
    const payload = JSON.stringify({
      phase: 'bootstrap',
      status: 'Bootstrapping app...',
      loaded: false,
      rendered: false,
      ready: false,
    });
    postSmokePayload(JSON.parse(payload) as Record<string, unknown>);
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
