import { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { missingFirebaseConfig } from './firebase';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  if (missingFirebaseConfig.length) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h2>Firebase is not configured</h2>
          <p>
            Missing values in <code>client/.env</code>: {missingFirebaseConfig.join(', ')}.
          </p>
          <p>Copy <code>client/.env.example</code> to <code>client/.env</code>, fill it in, then restart <code>npm run dev</code>.</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
