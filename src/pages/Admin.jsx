import { useEffect, useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const STATUS_COLORS = {
  pending_review: 'var(--warning)',
  completed:      'var(--success)',
  rejected:       'var(--danger)',
  failed:         'var(--muted)',
}

export default function Admin() {
  const { user } = useAuth()
  const [profile, setProfile]       = useState(null)
  const [orders, setOrders]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [processing, setProcessing] = useState(null)
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [msg, setMsg]   = useState('')
  const [err, setErr]   = useState('')

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      .then(({ data }) => {
        setProfile(data)
        if (data?.is_admin) fetchOrders()
        else setLoading(false)
      })
  }, [user])

  async function fetchOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, tickets(title, image_urls, image_url, file_url, category, event_date, location), profiles!orders_buyer_id_fkey(first_name, last_name, email)')
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  async function callAdmin(endpoint, order_id, action) {
    setProcessing(order_id)
    setMsg(''); setErr('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ order_id }),
    })
    const data = await res.json()
    if (!res.ok) { setErr(data.error || 'Action failed'); setProcessing(null); return }
    setMsg(`Order ${action} successfully.`)
    setOrders(os => os.map(o => o.id === order_id
      ? { ...o, status: action === 'approved' ? 'completed' : 'rejected' }
      : o
    ))
    setProcessing(null)
  }

  // ── Derived stats ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const pending   = orders.filter(o => o.status === 'pending_review').length
    const completed = orders.filter(o => o.status === 'completed')
    const rejected  = orders.filter(o => o.status === 'rejected').length
    const revenue   = completed.reduce((s, o) => s + Number(o.price), 0)
    return { pending, completed: completed.length, rejected, revenue }
  }, [orders])

  // ── Filtered orders ────────────────────────────────────────────
  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      const title  = o.tickets?.title?.toLowerCase() || ''
      const email  = o.profiles?.email?.toLowerCase() || ''
      const name   = `${o.profiles?.first_name || ''} ${o.profiles?.last_name || ''}`.toLowerCase()
      const pi     = o.stripe_payment_intent_id?.toLowerCase() || ''
      return title.includes(q) || email.includes(q) || name.includes(q) || pi.includes(q)
    })
  }, [orders, search, statusFilter])

  if (!user) return <Navigate to="/login" replace />
  if (loading) return <div className="page-loading">Loading…</div>
  if (!profile?.is_admin) return <Navigate to="/" replace />

  const pendingOrders   = filtered.filter(o => o.status === 'pending_review')
  const otherOrders     = filtered.filter(o => o.status !== 'pending_review')

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="section-title" style={{ marginBottom: '.25rem' }}>Admin Panel</h1>
          <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>{stats.pending} order{stats.pending !== 1 ? 's' : ''} pending review</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchOrders}>↻ Refresh</button>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Pending',   value: stats.pending,              color: 'var(--warning)' },
          { label: 'Completed', value: stats.completed,            color: 'var(--success)' },
          { label: 'Rejected',  value: stats.rejected,             color: 'var(--danger)'  },
          { label: 'Revenue',   value: `€${stats.revenue.toFixed(2)}`, color: 'var(--accent2)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.2rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}

      {/* Search + filter bar */}
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by ticket, buyer, or payment ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="all">All statuses</option>
          <option value="pending_review">Pending review</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Failed</option>
        </select>
        {(search || statusFilter !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusFilter('all') }}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* Pending review */}
      {pendingOrders.length > 0 && (
        <section style={{ marginBottom: '2.5rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--warning)' }}>
            ⏳ Pending Review ({pendingOrders.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pendingOrders.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                processing={processing}
                onApprove={id => callAdmin('admin-approve', id, 'approved')}
                onReject={id => callAdmin('admin-reject', id, 'rejected')}
              />
            ))}
          </div>
        </section>
      )}

      {/* Order history */}
      {otherOrders.length > 0 && (
        <section>
          <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--muted)' }}>
            Order History ({otherOrders.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {otherOrders.map(order => (
              <OrderCard key={order.id} order={order} processing={processing} readOnly />
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && (
        <div className="empty-state">
          <div style={{ fontSize: '3rem' }}>{orders.length === 0 ? '📭' : '🔍'}</div>
          <p>{orders.length === 0 ? 'No orders yet.' : 'No orders match your search.'}</p>
        </div>
      )}
    </div>
  )
}

function OrderCard({ order, processing, onApprove, onReject, readOnly }) {
  const cover     = order.tickets?.image_urls?.[0] || order.tickets?.image_url || null
  const buyerName = order.profiles
    ? `${order.profiles.first_name || ''} ${order.profiles.last_name || ''}`.trim() || order.profiles.email
    : 'Unknown'
  const eventDate = order.tickets?.event_date
    ? new Date(order.tickets.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {cover && (
        <img src={cover} alt="" style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
      )}

      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem', flexWrap: 'wrap' }}>
          <h3 style={{ fontWeight: 600, fontSize: '1rem' }}>{order.tickets?.title || 'Unknown ticket'}</h3>
          <span style={{ fontSize: '.75rem', fontWeight: 700, color: STATUS_COLORS[order.status] || 'var(--muted)', textTransform: 'uppercase' }}>
            {order.status.replace('_', ' ')}
          </span>
          {order.tickets?.category && (
            <span className="category-badge">{order.tickets.category}</span>
          )}
        </div>

        <p style={{ color: 'var(--muted)', fontSize: '.84rem' }}>
          Buyer: <strong style={{ color: 'var(--text)' }}>{buyerName}</strong>
          {' · '}
          <strong style={{ color: 'var(--accent2)' }}>€{Number(order.price).toFixed(2)}</strong>
          {' · '}
          {new Date(order.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>

        {eventDate && (
          <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: '.15rem' }}>
            📅 Event: {eventDate}
            {order.tickets?.location && ` · 📍 ${order.tickets.location}`}
          </p>
        )}

        {order.stripe_payment_intent_id && (
          <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.25rem', fontFamily: 'monospace' }}>
            PI:{' '}
            <a
              href={`https://dashboard.stripe.com/test/payments/${order.stripe_payment_intent_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent2)' }}
            >
              {order.stripe_payment_intent_id}
            </a>
          </p>
        )}

        {order.tickets?.file_url && (
          <a
            href={order.tickets.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm"
            style={{ marginTop: '.5rem', display: 'inline-flex' }}
          >
            📄 View ticket file
          </a>
        )}
      </div>

      {!readOnly && order.status === 'pending_review' && (
        <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
          <button
            className="btn btn-success btn-sm"
            onClick={() => onApprove(order.id)}
            disabled={processing === order.id}
          >
            {processing === order.id ? '…' : '✓ Approve'}
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => onReject(order.id)}
            disabled={processing === order.id}
          >
            {processing === order.id ? '…' : '✗ Reject'}
          </button>
        </div>
      )}
    </div>
  )
}
