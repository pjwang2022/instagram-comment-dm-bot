import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { MediaPage } from './pages/MediaPage';
import { AutomationEditorPage } from './pages/AutomationEditorPage';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<DashboardPage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/media/:mediaId/automation" element={<AutomationEditorPage />} />
        <Route path="/automations/new" element={<AutomationEditorPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
