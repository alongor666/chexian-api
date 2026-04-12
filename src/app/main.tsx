import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// ── Service Worker 注册（Phase 2: 离线优先 + 预取）──
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] Registration failed:', err);
    });
  });
  // 监听 ETL 更新消息，通知 React Query 刷新
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'ETL_UPDATED') {
      window.dispatchEvent(new CustomEvent('sw-etl-updated', { detail: event.data }));
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
