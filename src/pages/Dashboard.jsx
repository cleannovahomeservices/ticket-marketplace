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
  const [profile, setProfile]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectMsg, setConnectMsg] = useState('')
  const [connectErr, setConnectErr] = useState('')

  useEffect(() => {
    async function load() {
      const [{ data: tickets }, { data: orders }, { data: prof }] = await Promise.all([
        supabase.from('tickets').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }),
        supabase.from('orders').select('*, tickets(title, image_url, image_urls)').eq('buyer_id', user.id).order('created_at', { ascending: false }),
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
    await supabase.from('tickets').delete().eq('id', ticketId)
    setMyTickets(ts => ts.filter(t => t.id !== ticketId))
  }

  const handleConnectStripe = async () => {
    setConnectLoading(true)
    setConnectErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setConnectErr('You must be logged in to connect Stripe.')
        setConnectLoading(false)
        return
      }

      const res = await fetch('/api/stripe-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        setConnectErr(data.error || 'Failed to get Stripe onboarding URL.')
        setConnectLoading(false)
      }
    } catch (err) {
      console.error('Stripe connect error:', err);
      setConnectErr('Network error connecting to Stripe.')
      setConnectLoading(false)
    }
  };

  if (loading) return <div className="page-loading">Loading…</div>

  const displayName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ''}`.trim()
    : profile?.name || user.email

  const initials = profile?.first_name
    ? `${profile.first_name.charAt(0)}${(profile.last_name || '').charAt(0)}`.toUpperCase()
    : user.email.charAt(0).toUpperCase()

  return (
    <div className="page">
      {connectMsg && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{connectMsg}</div>}
      {connectErr && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{connectErr}</div>}

      {/* Profile header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="avatar-md" style={{ backgroundImage: profile?.avatar_url ? `url(${profile.avatar_url})` : 'none' }}>
          {!profile?.avatar_url && initials}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{displayName}</div>
          <div style={{ color: 'var(--muted)', fontSize: '.88rem' }}>{user.email}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {!profile?.stripe_account_id && (
            <button className="btn btn-connect btn-sm" onClick={handleConnectStripe} disabled={connectLoading}>
              {connectLoading ? 'Redirecting…' : '💳 Connect payout account'}
            </button>
          )}
          {profile?.stripe_account_id && (
            <button className="btn btn-outline btn-sm" onClick={handleConnectStripe} disabled={connectLoading}>
              {connectLoading ? 'Redirecting…' : '💳 Manage payouts'}
            </button>
          )}
          <Link to="/profile" className="btn btn-outline btn-sm">Edit profile</Link>
          <Link to="/create" className="btn btn-primary btn-sm">+ Sell ticket</Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="dashboard-tabs">
        {[
          { key: 'selling', label: `My Listings (${myTickets.length})` },
          { key: 'buying',  label: `My Orders (${myOrders.length})` },
        ].map(t => (
          <button key={t.key} className={`dashboard-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Selling */}
      {tab === 'selling' && (
        myTickets.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '3rem' }}>🎟</div>
            <p>You haven't listed any tickets yet.</p>
            <Link to="/create" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-flex' }}>Sell your first ticket</Link>
          </div>
        ) : (
          <div className="tickets-grid">
            {myTickets.map(ticket => (
              <div key={ticket.id}>
                <TicketCard ticket={ticket} />
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                  <Link to={`/edit/${ticket.id}`} className="btn btn-outline btn-sm" style={{ flex: 1, justifyContent: 'center' }}>Edit</Link>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTicket(ticket.id)} style={{ flex: 1 }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Buying */}
      {tab === 'buying' && (
        myOrders.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '3rem' }}>🛒</div>
            <p>You haven't bought any tickets yet.</p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-flex' }}>Browse tickets</Link>
          </div>
        ) : (
          <div className="orders-list">
            {myOrders.map(order => {
              const cover = order.tickets?.image_urls?.[0] || order.tickets?.image_url || null
              return (
                <div key={order.id} className="card order-card">
                  {cover && <img src={cover} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
                  <div className="order-info" style={{ flex: 1 }}>
                    <h4>{order.tickets?.title || 'Ticket'}</h4>
                    <p>Ordered {new Date(order.created_at).toLocaleDateString()} · <strong>{order.status}</strong></p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                    <span className="order-price">€{Number(order.price).toFixed(2)}</span>
                    {order.status === 'pending' && <span style={{ color: 'var(--warning)', fontWeight: 600, fontSize: '.85rem' }}>⏳ Waiting for seller</span>}
                    {order.status === 'accepted' && <span style={{ color: 'var(--accent2)', fontWeight: 600, fontSize: '.85rem' }}>💳 Pay now</span>}
                    {order.status === 'paid' && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '.85rem' }}>✓ Paid</span>}
                    {order.status === 'pending_review' && <span style={{ color: 'var(--warning)', fontWeight: 600, fontSize: '.85rem' }}>⏳ Pending review</span>}
                    {order.status === 'completed' && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '.85rem' }}>✓ Completed</span>}
                    {order.status === 'rejected' && <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '.85rem' }}>✗ Rejected</span>}
                    {order.status === 'failed' && <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: '.85rem' }}>Failed</span>}
                    <Link to={`/ticket/${order.ticket_id}`} className="btn btn-ghost btn-sm">View</Link>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
