import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AdminOverview from './pages/admin/Overview';
import AdminEmployees from './pages/admin/Employees';
import AdminClients from './pages/admin/Clients';
import AdminLeaderboard from './pages/admin/Leaderboard';
import AdminResources from './pages/admin/Resources';
import AdminLeads from './pages/admin/Leads';
import AdminSignups from './pages/admin/Signups';
import ClientDetail from './pages/admin/ClientDetail';
import MyClients from './pages/employee/MyClients';
import ClientWorkspace from './pages/employee/ClientWorkspace';
import ClientDashboard from './pages/client/Dashboard';
import { Skeleton } from './components/ui';

const HOME = { admin: '/admin', employee: '/employee', client: '/client' };

function Protected({ roles, children }) {
  const { user, booting } = useAuth();
  if (booting) {
    return (
      <div className="min-h-screen bg-ivory p-10">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={HOME[user.role] || '/login'} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route path="/admin" element={<Protected roles={['admin']}><AdminOverview /></Protected>} />
          <Route path="/admin/employees" element={<Protected roles={['admin']}><AdminEmployees /></Protected>} />
          <Route path="/admin/clients" element={<Protected roles={['admin']}><AdminClients /></Protected>} />
          <Route path="/admin/clients/:id" element={<Protected roles={['admin']}><ClientDetail /></Protected>} />
          <Route path="/admin/leaderboard" element={<Protected roles={['admin']}><AdminLeaderboard /></Protected>} />
          <Route path="/admin/resources" element={<Protected roles={['admin']}><AdminResources /></Protected>} />
          <Route path="/admin/leads" element={<Protected roles={['admin']}><AdminLeads /></Protected>} />
          <Route path="/admin/signups" element={<Protected roles={['admin']}><AdminSignups /></Protected>} />

          <Route path="/employee" element={<Protected roles={['employee', 'admin']}><MyClients /></Protected>} />
          <Route path="/employee/clients/:id" element={<Protected roles={['employee', 'admin']}><ClientWorkspace /></Protected>} />

          <Route path="/client" element={<Protected roles={['client']}><ClientDashboard /></Protected>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
