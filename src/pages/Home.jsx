import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import TicketCard from '../components/TicketCard'

export default function Home() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetchTickets() {
      const { data } = await supabase
        .from('tickets')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      setTickets(data || [])
      setLoading(false)
    }
    fetchTickets()
  }, [])

  const filtered = tickets.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    (t.location && t.location.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="page">
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '.5rem' }}>Browse Tickets</h1>
        <p style={{ color: 'var(--muted)' }}>Find tickets for concerts, events, travel and more.</p>
      </div>

      <div className="form-group" style={{ maxWidth: 420, marginBottom: '1.75rem' }}>
        <input
          type="text"
          placeholder="Search by title or location…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="page-loading">Loading tickets…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '3rem' }}>🎟</div>
          <p>{search ? 'No tickets match your search.' : 'No tickets listed yet. Be the first!'}</p>
        </div>
      ) : (
        <div className="tickets-grid">
          {filtered.map(ticket => <TicketCard key={ticket.id} ticket={ticket} />)}
        </div>
      )}
    </div>
  )
}
