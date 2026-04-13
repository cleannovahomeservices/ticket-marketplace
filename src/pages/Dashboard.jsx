import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TicketCard from '../components/TicketCard'

export default function Dashboard() {
  const { user } = useAuth()
  const [tab, setTab] = useState('selling')
  const [myTickets, setMyTickets] = useState([])
  const [myOrders, setMyOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    async function load() {
      const [{ data: tickets }, { data: orders }, { data: prof }] = await Promise.all([
        supabase.from('tickets').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }),
        supabase.from('orders').select('*, tickets(title, image_url)').eq('buyer_id', user.id).order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').eq('id', user.id).single(),
      ])
      setMyTickets(tickets || [])
      setMyOrders(orders || [])
      setProfile(prof)
      setLoading(false)
    }
    load()
  }, [user.id])

  async function handleDeleteTicket(ticketId) {
    if (!confirm('Delete this listing?')) return
    await supabase.from('tickets').delete().eq('id', ticketId)
    setMyTickets(ts => ts.filter(t => t.id !== ticketId))
  }

  async function handleCompleteOrder(order) {
    setActionLoading(true)
    await supabase.from('orders').update({ status: 'completed' }).eq('id', order.id)
    await supabase.from('tickets').update({ status: 'sold' }).eq('id', order.ticket_id)
    setMyOrders(os => os.map(o => o.id === order.id ? { ...o, status: 'completed' } : o))
    setActionLoading(false)
  }

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      {/* Profile header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {(profile?.name || user.email).charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{profile?.name || 'My Account'}</div>
          <div style={{ color: 'var(--muted)', fontSize: '.88rem' }}>{user.email}</div>
        </div>
        <Link to="/create" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>+ Sell ticket</Link>
      </div>

      {/* Tabs */}
      <div className="dashboard-tabs">
        <button className={`dashboard-tab ${tab === 'selling' ? 'active' : ''}`} onClick={() => setTab('selling')}>
          My Listings ({myTickets.length})
        </button>
        <button className={`dashboard-tab ${tab === 'buying' ? 'active' : ''}`} onClick={() => setTab('buying')}>
          My Orders ({myOrders.length})
        </button>
      </div>

      {/* Selling tab */}
      {tab === 'selling' && (
        myTickets.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '3rem' }}>🎟</div>
            <p>You haven't listed any tickets yet.</p>
            <Link to="/create" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-flex' }}>Sell your first ticket</Link>
          </div>
        ) : (
          <div>
            <div className="tickets-grid">
              {myTickets.map(ticket => (
                <div key={ticket.id} style={{ position: 'relative' }}>
                  <TicketCard ticket={ticket} />
                  <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                    <Link to={`/edit/${ticket.id}`} className="btn btn-outline btn-sm" style={{ flex: 1, justifyContent: 'center' }}>Edit</Link>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTicket(ticket.id)} style={{ flex: 1 }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* Buying tab */}
      {tab === 'buying' && (
        myOrders.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '3rem' }}>🛒</div>
            <p>You haven't bought any tickets yet.</p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-flex' }}>Browse tickets</Link>
          </div>
        ) : (
          <div className="orders-list">
            {myOrders.map(order => (
              <div key={order.id} className="card order-card">
                <div className="order-info">
                  <h4>{order.tickets?.title || 'Ticket'}</h4>
                  <p>Status: <strong>{order.status}</strong> · Ordered {new Date(order.created_at).toLocaleDateString()}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <span className="order-price">${Number(order.price).toFixed(2)}</span>
                  {order.status === 'pending' && (
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => handleCompleteOrder(order)}
                      disabled={actionLoading}
                    >
                      Complete purchase
                    </button>
                  )}
                  {order.status === 'completed' && (
                    <span style={{ color: 'var(--success)', fontSize: '.85rem', fontWeight: 600 }}>✓ Completed</span>
                  )}
                  <Link to={`/ticket/${order.ticket_id}`} className="btn btn-ghost btn-sm">View ticket</Link>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
