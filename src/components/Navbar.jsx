import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
    setMenuOpen(false)
  }

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">🎟 TicketMarket</Link>

      <div className="navbar-links">
        {user ? (
          <>
            <Link to="/create" className="btn btn-primary btn-sm">+ Sell Ticket</Link>
            <div className="nav-menu-wrap">
              <button className="nav-avatar-btn" onClick={() => setMenuOpen(o => !o)}>
                <div className="nav-avatar">{user.email.charAt(0).toUpperCase()}</div>
              </button>
              {menuOpen && (
                <div className="nav-dropdown">
                  <Link to="/dashboard" className="nav-dropdown-item" onClick={() => setMenuOpen(false)}>📊 Dashboard</Link>
                  <Link to="/favorites" className="nav-dropdown-item" onClick={() => setMenuOpen(false)}>❤️ Favorites</Link>
                  <Link to="/alerts" className="nav-dropdown-item" onClick={() => setMenuOpen(false)}>🔔 Alerts</Link>
                  <Link to="/profile" className="nav-dropdown-item" onClick={() => setMenuOpen(false)}>👤 Profile</Link>
                  {isAdmin && <Link to="/admin" className="nav-dropdown-item" onClick={() => setMenuOpen(false)}>🛡 Admin</Link>}
                  <hr style={{ margin: '.25rem 0', border: 'none', borderTop: '1px solid var(--border)' }} />
                  <button className="nav-dropdown-item nav-dropdown-item--danger" onClick={handleLogout}>Log out</button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Link to="/login"  className="btn btn-ghost btn-sm">Log in</Link>
            <Link to="/signup" className="btn btn-primary btn-sm">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  )
}
