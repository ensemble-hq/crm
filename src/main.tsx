import '@fontsource-variable/inter';
import '@mariachi/design/mariachi.css';
import '@mariachi/design/themes/keel.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell';
import { WorkspaceProvider } from './app/WorkspaceProvider';
import { AssistantPage } from './pages/Assistant';
import { ComingSoon } from './pages/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { Inbox } from './pages/Inbox';
import { RecordDetail } from './pages/RecordDetail';
import { RecordList } from './pages/RecordList';
import { ObjectSettings, Settings } from './pages/Settings';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

/** Areas the navigation links to that have no screen yet. Listed so they don't match `/:objectId`. */
const PLACEHOLDERS = ['sequences', 'workflows', 'reports'];

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <WorkspaceProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="inbox/:conversationId" element={<Inbox />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/objects/:objectId" element={<ObjectSettings />} />
            {PLACEHOLDERS.map((path) => (
              <Route key={path} path={`${path}/*`} element={<ComingSoon />} />
            ))}
            <Route path=":objectId" element={<RecordList />} />
            <Route path=":objectId/:recordId" element={<RecordDetail />} />
            <Route path="*" element={<ComingSoon />} />
          </Route>
        </Routes>
      </WorkspaceProvider>
    </BrowserRouter>
  </StrictMode>,
);
