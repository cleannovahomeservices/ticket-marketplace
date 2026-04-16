import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PLATFORM_FEE_PCT = 0.05

// Derive the balance-page status from the underlying order fields.
// Three states only:
//   pending_review — admin hasn't approved yet, money still held by platform
//   approved       — admin approved, transfer not yet confirmed (money on the way)
//   paid_out       — Stripe transfer succeeded, funds credited to seller
function balanceStatusOf(order) {
  if (order.paid_out_at) return 'paid_out'
  if (order.status === 'completed') return 'approved'
  return 'pending_review'
}

// Fallback when seller_amount hasn't been written yet (order still in review).
function sellerAmountOf(order) {
  if (order.seller_amount != null) return Number(order.seller_amount)
  return +(Number(order.price) * (1 - PLATFORM_FEE_PCT)).toFixed(2)
}

const STATUS_META = {
  pending_review: { label: 'Pending review',    color: 'var(--muted)',   dot: '#94a3b8' },
  approved:       { label: 'Money on the way',  color: 'var(--warning)', dot: '#fcd34d' },
  paid_out:       { label: 'Paid out',          color: 'var(--success)', dot: '#86efac' },
}

export default function Balance() {
  const { user } = useAuth()
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: selErr } = await supabase
        .from('orders')
        .select('id, price, seller_amount, transfer_id, paid_out_at, status, created_at, ticket_id, tickets(title, image_url, image_urls)')
        .eq('seller_id', user.id)
        .in('status', ['pending_admin_review', 'completed'])
        .order('created_at', { ascending: false })
      if (!alive) return
      if (selErr) {
        console.error('[balance] load failed:', selErr.message)
        setError(selErr.message)
      }
      setOrders(data || [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [user.id])

  const { pending, completed, pendingList, completedList } = useMemo(() => {
    let pending = 0, completed = 0
    const pendingList = [], completedList = []
    for (const o of orders) {
      const net = sellerAmountOf(o)
      if (o.paid_out_at) { completed += net; completedList.push(o) }
      else               { pending   += net; pendingList.push(o)   }
    }
    return {
      pending:   +pending.toFixed(2),
      completed: +completed.toFixed(2),
      pendingList, completedList,
    }
  }, [orders])

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <div>
          <h1 className="section-title" style={{ marginBottom: '.25rem' }}>Balance</h1>
          <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>Earnings from ticket sales after the 5% service fee.</p>
        </div>
        <Link to="/dashboard" className="btn btn-ghost btn-sm">← Back to dashboard</Link>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="balance-summary">
        <div className="balance-card balance-card--pending">
          <div className="balance-card-label">Pending</div>
          <div className="balance-card-amount">€{pending.toFixed(2)}</div>
          <div className="balance-card-sub">{pendingList.length} order{pendingList.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="balance-card balance-card--completed">
          <div className="balance-card-label">Paid out</div>
          <div className="balance-card-amount">€{completed.toFixed(2)}</div>
          <div className="balance-card-sub">{completedList.length} order{completedList.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <Section title="Pending" orders={pendingList} emptyText="No pending earnings." />
      <Section title="Paid out" orders={completedList} emptyText="No completed payouts yet." />
    </div>
  )
}

function Section({ title, orders, emptyText }) {
  if (orders.length === 0) {
    return (
      <section style={{ marginTop: '2rem' }}>
        <h2 className="balance-section-title">{title}</h2>
        <div className="balance-empty">{emptyText}</div>
      </section>
    )
  }
  return (
    <section style={{ marginTop: '2rem' }}>
      <h2 className="balance-section-title">{title}</h2>
      <div className="balance-list">
        {orders.map(o => <BalanceRow key={o.id} order={o} />)}
      </div>
    </section>
  )
}

function BalanceRow({ order }) {
  const cover  = order.tickets?.image_urls?.[0] || order.tickets?.image_url || null
  const net    = sellerAmountOf(order)
  const status = balanceStatusOf(order)
  const meta   = STATUS_META[status]
  const dateLabel = order.paid_out_at
    ? new Date(order.paid_out_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : new Date(order.created_at).toLocaleDateString('en-US',  { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <Link to={`/ticket/${order.ticket_id}`} className="balance-row">
      {cover
        ? <img className="balance-row-thumb" src={cover} alt="" />
        : <div className="balance-row-thumb balance-row-thumb--placeholder">🎟</div>
      }
      <div className="balance-row-body">
        <div className="balance-row-title">{order.tickets?.title || 'Ticket'}</div>
        <div className="balance-row-meta">
          <span className="balance-row-dot" style={{ background: meta.dot }} />
          <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
          <span style={{ color: 'var(--muted)' }}>· {dateLabel}</span>
        </div>
        {order.transfer_id && (
          <div className="balance-row-transfer" title={order.transfer_id}>
            Transfer · <code>{order.transfer_id}</code>
          </div>
        )}
      </div>
      <div className="balance-row-amount">€{net.toFixed(2)}</div>
    </Link>
  )
}
