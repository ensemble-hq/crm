import '@fontsource-variable/inter';
import '@mariachi/design/mariachi.css';
import '@mariachi/design/themes/keel.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell';
import { WorkspaceProvider } from './app/WorkspaceProvider';
import { ComingSoon } from './pages/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { RecordDetail } from './pages/RecordDetail';
import { RecordList } from './pages/RecordList';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

/** Areas the navigation links to that have no screen yet. Listed so they don't match `/:objectId`. */
const PLACEHOLDERS = ['inbox', 'tasks', 'sequences', 'workflows', 'reports', 'settings'];

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <WorkspaceProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
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
