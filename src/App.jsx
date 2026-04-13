import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'

import Home         from './pages/Home'
import Login        from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword  from './pages/ResetPassword'
import TicketDetail from './pages/TicketDetail'
import CreateTicket from './pages/CreateTicket'
import Dashboard    from './pages/Dashboard'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/"               element={<Home />} />
          <Route path="/login"          element={<Login />} />
          <Route path="/auth/callback"  element={<AuthCallback />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/ticket/:id"     element={<TicketDetail />} />
          <Route path="/create"         element={<ProtectedRoute><CreateTicket /></ProtectedRoute>} />
          <Route path="/edit/:id"       element={<ProtectedRoute><CreateTicket /></ProtectedRoute>} />
          <Route path="/dashboard"      element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
