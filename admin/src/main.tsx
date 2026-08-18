import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { AutomationEditorPage } from './pages/AutomationEditorPage';
import { AccountPage } from './pages/AccountPage';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<HomePage />} />
        {/* 舊書籤相容：貼文頁已併入首頁 */}
        <Route path="/media" element={<Navigate to="/" replace />} />
        <Route path="/media/:mediaId/automation" element={<AutomationEditorPage />} />
        <Route path="/automations/new" element={<AutomationEditorPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
