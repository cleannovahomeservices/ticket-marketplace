import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const CATEGORIES = ['concerts', 'sports', 'travel', 'events', 'experiences']

export default function Alerts() {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ keyword: '', max_price: '', category: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('alerts').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data }) => { setAlerts(data || []); setLoading(false) })
  }, [user.id])

  function handleChange(e) { setForm(f => ({ ...f, [e.target.name]: e.target.value })) }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.keyword && !form.category) { setError('Enter a keyword or select a category.'); return }
    setSaving(true)
    setError('')
    const { data, error } = await supabase.from('alerts').insert({
      user_id: user.id,
      keyword: form.keyword || null,
      max_price: form.max_price ? parseFloat(form.max_price) : null,
      category: form.category || null,
    }).select().single()
    if (error) { setError(error.message); setSaving(false); return }
    setAlerts(a => [data, ...a])
    setForm({ keyword: '', max_price: '', category: '' })
    setSaving(false)
  }

  async function handleDelete(id) {
    await supabase.from('alerts').delete().eq('id', id)
    setAlerts(a => a.filter(x => x.id !== id))
  }

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <h1 className="section-title">My Alerts</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.75rem', fontSize: '.93rem' }}>
        We'll notify you when a matching ticket is listed.
      </p>

      {/* Create alert */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '1rem' }}>New alert</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <div className="form-group">
              <label>Keyword (event name)</label>
              <input name="keyword" value={form.keyword} onChange={handleChange} placeholder="e.g. Taylor Swift" />
            </div>
            <div className="form-group">
              <label>Max price (USD)</label>
              <input name="max_price" type="number" min="0" step="0.01" value={form.max_price} onChange={handleChange} placeholder="Any price" />
            </div>
          </div>
          <div className="form-group">
            <label>Category (optional)</label>
            <select name="category" value={form.category} onChange={handleChange}>
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : '+ Create alert'}
          </button>
        </form>
      </div>

      {/* Alert list */}
      {alerts.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem' }}>
          <p>No alerts yet. Create your first one above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {alerts.map(alert => (
            <div key={alert.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem', padding: '1rem 1.25rem' }}>
              <div>
                {alert.keyword && <span style={{ fontWeight: 600 }}>"{alert.keyword}"</span>}
                {alert.category && <span className="category-badge category-badge--{alert.category}" style={{ marginLeft: alert.keyword ? '.5rem' : 0 }}>{alert.category}</span>}
                {alert.max_price && <span style={{ color: 'var(--muted)', fontSize: '.85rem', marginLeft: '.5rem' }}>· max ${alert.max_price}</span>}
                {!alert.keyword && !alert.category && <span style={{ color: 'var(--muted)' }}>All tickets</span>}
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(alert.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
