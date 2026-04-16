import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'

const Login          = lazy(() => import('./pages/Login'))
const Signup         = lazy(() => import('./pages/Signup'))
const AuthCallback   = lazy(() => import('./pages/AuthCallback'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword  = lazy(() => import('./pages/ResetPassword'))
const TicketDetail   = lazy(() => import('./pages/TicketDetail'))
const CreateTicket   = lazy(() => import('./pages/CreateTicket'))
const Dashboard      = lazy(() => import('./pages/Dashboard'))
const Balance        = lazy(() => import('./pages/Balance'))
const Profile        = lazy(() => import('./pages/Profile'))
const Favorites      = lazy(() => import('./pages/Favorites'))
const Alerts         = lazy(() => import('./pages/Alerts'))
const Admin          = lazy(() => import('./pages/Admin'))
const Reauth         = lazy(() => import('./pages/Reauth'))

const Fallback = () => <div className="page-loading">Loading…</div>

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path="/"                element={<Home />} />
            <Route path="/login"           element={<Login />} />
            <Route path="/signup"          element={<Signup />} />
            <Route path="/auth/callback"   element={<AuthCallback />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password"  element={<ResetPassword />} />
            <Route path="/ticket/:id"      element={<TicketDetail />} />
            <Route path="/create"          element={<ProtectedRoute><CreateTicket /></ProtectedRoute>} />
            <Route path="/edit/:id"        element={<ProtectedRoute><CreateTicket /></ProtectedRoute>} />
            <Route path="/dashboard"          element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/balance"  element={<ProtectedRoute><Balance /></ProtectedRoute>} />
            <Route path="/profile"         element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/favorites"       element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
            <Route path="/alerts"          element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
            <Route path="/admin"           element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/reauth"          element={<ProtectedRoute><Reauth /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
