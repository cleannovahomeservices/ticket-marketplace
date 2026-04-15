import { useEffect, useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const STATUS_COLORS = {
  pending_payment:      'var(--muted)',
  paid_pending_ticket:  'var(--accent2)',
  pending_admin_review: 'var(--warning)',
  completed:            'var(--success)',
  rejected:             'var(--danger)',
}

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const [orders, setOrders]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [processing, setProcessing] = useState(null)
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState('pending_admin_review')
  const [previews, setPreviews]     = useState({})
  const [msg, setMsg]   = useState('')
  const [err, setErr]   = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user || !isAdmin) { setLoading(false); return }
    fetchOrders()
  }, [authLoading, user, isAdmin])

  async function fetchOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, tickets(title, image_urls, image_url, category, event_date, location), profiles!orders_buyer_id_fkey(first_name, last_name, email), seller:profiles!orders_seller_id_fkey(first_name, last_name, email)')
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
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(data.error || 'Action failed')
      setProcessing(null)
      return
    }
    setMsg(`Order ${action}.`)
    setOrders(os => os.map(o => o.id === order_id
      ? { ...o, status: action === 'approved' ? 'completed' : 'rejected' }
      : o
    ))
    setProcessing(null)
  }

  // Pull a signed preview URL for the uploaded ticket file.
  async function fetchPreview(order) {
    if (!order.ticket_file_url || previews[order.id]) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/ticket-file?order_id=${order.id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.url) setPreviews(p => ({ ...p, [order.id]: data.url }))
  }

  const stats = useMemo(() => {
    const pendingReview = orders.filter(o => o.status === 'pending_admin_review').length
    const completed     = orders.filter(o => o.status === 'completed')
    const rejected      = orders.filter(o => o.status === 'rejected').length
    const revenue       = completed.reduce((s, o) => s + Number(o.price), 0)
    return { pendingReview, completed: completed.length, rejected, revenue }
  }, [orders])

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      const title = o.tickets?.title?.toLowerCase() || ''
      const email = o.profiles?.email?.toLowerCase() || ''
      const name  = `${o.profiles?.first_name || ''} ${o.profiles?.last_name || ''}`.toLowerCase()
      const pi    = o.stripe_payment_intent_id?.toLowerCase() || ''
      return title.includes(q) || email.includes(q) || name.includes(q) || pi.includes(q)
    })
  }, [orders, search, statusFilter])

  // Eagerly prefetch preview URLs for orders currently being shown.
  useEffect(() => {
    filtered.filter(o => o.status === 'pending_admin_review' && o.ticket_file_url)
      .forEach(fetchPreview)
  }, [filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/" replace />

  const pendingReviews = filtered.filter(o => o.status === 'pending_admin_review')
  const otherOrders    = filtered.filter(o => o.status !== 'pending_admin_review')

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="section-title" style={{ marginBottom: '.25rem' }}>Admin Panel</h1>
          <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>
            {stats.pendingReview} order{stats.pendingReview !== 1 ? 's' : ''} awaiting review
          </p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchOrders}>↻ Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Pending Review', value: stats.pendingReview,              color: 'var(--warning)' },
          { label: 'Completed',      value: stats.completed,                  color: 'var(--success)' },
          { label: 'Rejected',       value: stats.rejected,                   color: 'var(--danger)'  },
          { label: 'Revenue',        value: `€${stats.revenue.toFixed(2)}`,   color: 'var(--accent2)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.2rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}

      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by ticket, buyer, or payment ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All statuses</option>
          <option value="pending_payment">Pending payment</option>
          <option value="paid_pending_ticket">Paid · awaiting seller</option>
          <option value="pending_admin_review">Pending admin review</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
        </select>
        {(search || statusFilter !== 'pending_admin_review') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusFilter('pending_admin_review') }}>
            ✕ Reset
          </button>
        )}
      </div>

      {pendingReviews.length > 0 && (
        <section style={{ marginBottom: '2.5rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--warning)' }}>
            🛡 Pending verification ({pendingReviews.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pendingReviews.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                previewUrl={previews[order.id]}
                processing={processing}
                onApprove={id => callAdmin('admin-approve', id, 'approved')}
                onReject={id => callAdmin('admin-reject', id, 'rejected')}
              />
            ))}
          </div>
        </section>
      )}

      {otherOrders.length > 0 && (
        <section>
          <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--muted)' }}>
            Other orders ({otherOrders.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {otherOrders.map(order => (
              <OrderCard key={order.id} order={order} previewUrl={previews[order.id]} processing={processing} readOnly />
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

function OrderCard({ order, previewUrl, processing, onApprove, onReject, readOnly }) {
  const cover     = order.tickets?.image_urls?.[0] || order.tickets?.image_url || null
  const buyerName = order.profiles
    ? `${order.profiles.first_name || ''} ${order.profiles.last_name || ''}`.trim() || order.profiles.email
    : 'Unknown buyer'
  const sellerName = order.seller
    ? `${order.seller.first_name || ''} ${order.seller.last_name || ''}`.trim() || order.seller.email
    : 'Unknown seller'
  const eventDate = order.tickets?.event_date
    ? new Date(order.tickets.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const isImagePreview = previewUrl && /(\.png|\.jpe?g|\.webp|\.gif|\.avif)(\?|$)/i.test(previewUrl)

  return (
    <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {cover && (
        <img src={cover} alt="" style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
      )}

      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem', flexWrap: 'wrap' }}>
          <h3 style={{ fontWeight: 600, fontSize: '1rem' }}>{order.tickets?.title || 'Unknown ticket'}</h3>
          <span style={{ fontSize: '.75rem', fontWeight: 700, color: STATUS_COLORS[order.status] || 'var(--muted)', textTransform: 'uppercase' }}>
            {order.status.replace(/_/g, ' ')}
          </span>
          {order.tickets?.category && (
            <span className="category-badge">{order.tickets.category}</span>
          )}
        </div>

        <p style={{ color: 'var(--muted)', fontSize: '.84rem' }}>
          <strong style={{ color: 'var(--text)' }}>{buyerName}</strong> → <strong style={{ color: 'var(--text)' }}>{sellerName}</strong>
          {' · '}
          <strong style={{ color: 'var(--accent2)' }}>€{Number(order.price).toFixed(2)}</strong>
          {' · '}
          {new Date(order.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>

        {eventDate && (
          <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: '.15rem' }}>
            📅 {eventDate}{order.tickets?.location && ` · 📍 ${order.tickets.location}`}
          </p>
        )}

        {order.stripe_payment_intent_id && (
          <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.25rem', fontFamily: 'monospace' }}>
            PI:{' '}
            <a href={`https://dashboard.stripe.com/test/payments/${order.stripe_payment_intent_id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent2)' }}>
              {order.stripe_payment_intent_id}
            </a>
          </p>
        )}

        {order.ticket_file_url && (
          <div style={{ marginTop: '.6rem' }}>
            {isImagePreview ? (
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <img src={previewUrl} alt="Uploaded ticket" style={{ maxWidth: 260, maxHeight: 260, borderRadius: 8, border: '1px solid var(--border)' }} />
              </a>
            ) : previewUrl ? (
              <a className="btn btn-outline btn-sm" href={previewUrl} target="_blank" rel="noopener noreferrer">📄 Open uploaded ticket</a>
            ) : (
              <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Loading preview…</span>
            )}
          </div>
        )}
      </div>

      {!readOnly && order.status === 'pending_admin_review' && (
        <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
          <button className="btn btn-success btn-sm" onClick={() => onApprove(order.id)} disabled={processing === order.id}>
            {processing === order.id ? '…' : '✓ Approve'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => onReject(order.id)} disabled={processing === order.id}>
            {processing === order.id ? '…' : '✗ Reject'}
          </button>
        </div>
      )}
    </div>
  )
}
