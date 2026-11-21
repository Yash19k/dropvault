import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import Files from './pages/dashboard/Files';

// The admin panel is only downloaded by admins.
const AdminOverview = lazy(() => import('./pages/admin/Overview'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminUser = lazy(() => import('./pages/admin/UserDetail'));
const AdminFiles = lazy(() => import('./pages/admin/Files'));
const AdminLinks = lazy(() => import('./pages/admin/Links'));
const AdminActivity = lazy(() => import('./pages/admin/Activity'));
const AdminSystem = lazy(() => import('./pages/admin/System'));

function RequireAuth({ children }) {
  const { isAuthenticated, renewing } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // An expired session is being renewed: wait instead of calling the API with a dead token.
  if (renewing) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted">
        <span className="flex items-center gap-2"><Spinner /> Restoring your session…</span>
      </div>
    );
  }
  return children;
}

// Only shows the admin panel to admins; the admin API checks again on every request.
function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/app" replace />;
  return (
    <Suspense fallback={<div className="grid place-items-center py-24 text-muted"><Spinner /></div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={isAuthenticated ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/signup" element={isAuthenticated ? <Navigate to="/app" replace /> : <SignUp />} />
      <Route path="/app" element={<RequireAuth><DashboardLayout /></RequireAuth>}>
        <Route index element={<Files />} />
      </Route>
      <Route path="/admin" element={<RequireAuth><DashboardLayout /></RequireAuth>}>
        <Route index element={<RequireAdmin><AdminOverview /></RequireAdmin>} />
        <Route path="users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
        <Route path="users/:userId" element={<RequireAdmin><AdminUser /></RequireAdmin>} />
        <Route path="files" element={<RequireAdmin><AdminFiles /></RequireAdmin>} />
        <Route path="links" element={<RequireAdmin><AdminLinks /></RequireAdmin>} />
        <Route path="activity" element={<RequireAdmin><AdminActivity /></RequireAdmin>} />
        <Route path="system" element={<RequireAdmin><AdminSystem /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
