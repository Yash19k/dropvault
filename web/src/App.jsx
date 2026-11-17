import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import Files from './pages/dashboard/Files';

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
