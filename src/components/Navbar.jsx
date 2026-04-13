import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        🎟 TicketMarket
      </Link>

      <div className="navbar-links">
        {user ? (
          <>
            <Link to="/create" className="btn btn-primary btn-sm">+ Sell Ticket</Link>
            <Link to="/dashboard" className="btn btn-ghost btn-sm">My Account</Link>
            <button onClick={handleLogout} className="btn btn-ghost btn-sm">Log out</button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
            <Link to="/login?tab=signup" className="btn btn-primary btn-sm">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  )
}
