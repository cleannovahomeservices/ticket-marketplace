import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TicketCard from '../components/TicketCard'

export default function Favorites() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('favorites')
      .select('ticket_id, tickets(*)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setTickets((data || []).map(f => f.tickets).filter(Boolean))
        setLoading(false)
      })
  }, [user.id])

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <h1 className="section-title">My Favorites</h1>
      {tickets.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '3rem' }}>🤍</div>
          <p>You haven't saved any tickets yet.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-flex' }}>Browse tickets</Link>
        </div>
      ) : (
        <div className="tickets-grid">
          {tickets.map(t => <TicketCard key={t.id} ticket={t} />)}
        </div>
      )}
    </div>
  )
}
