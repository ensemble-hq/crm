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
import { Forecast } from './pages/Forecast';
import { FormBuilder, Forms, PublicForm } from './pages/Forms';
import { ImportPage } from './pages/Import';
import { Inbox } from './pages/Inbox';
import { Meetings, PublicBooking } from './pages/Meetings';
import { People } from './pages/People';
import { RecordDetail } from './pages/RecordDetail';
import { RecordList } from './pages/RecordList';
import { Unsubscribe } from './pages/Unsubscribe';
import { AuditLog } from './pages/AuditLog';
import { ReportBuilder, Reports } from './pages/Reports';
import { SequenceDetail, Sequences } from './pages/Sequences';
import { ObjectSettings, Settings } from './pages/Settings';
import { WorkflowBuilder } from './pages/WorkflowBuilder';
import { Workflows } from './pages/Workflows';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public pages: no navigation and no sign-in, for people outside the team. They sit outside the workspace, which only members can load. */}
        <Route path="f/:formId" element={<PublicForm />} />
        <Route path="book/:pageId" element={<PublicBooking />} />
        <Route path="u/:token" element={<Unsubscribe />} />
        <Route
          element={
            <WorkspaceProvider>
              <Shell />
            </WorkspaceProvider>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="inbox/:conversationId" element={<Inbox />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="forecast" element={<Forecast />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/:reportId" element={<ReportBuilder />} />
          <Route path="sequences" element={<Sequences />} />
          <Route path="sequences/:sequenceId" element={<SequenceDetail />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="workflows/:workflowId" element={<WorkflowBuilder />} />
          <Route path="forms" element={<Forms />} />
          <Route path="forms/:formId" element={<FormBuilder />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/objects/:objectId" element={<ObjectSettings />} />
          <Route path="settings/people" element={<People />} />
          <Route path="settings/audit" element={<AuditLog />} />
          <Route path=":objectId" element={<RecordList />} />
          <Route path=":objectId/:recordId" element={<RecordDetail />} />
          <Route path="*" element={<ComingSoon />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
