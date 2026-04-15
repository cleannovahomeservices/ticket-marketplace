import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import TicketCard from '../components/TicketCard'

const CATEGORIES = ['concerts', 'sports', 'travel', 'events', 'experiences']
const CATEGORY_EMOJI = { concerts: '🎵', sports: '⚽', travel: '✈️', events: '🎉', experiences: '🌟' }

export default function Home() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('newest')
  const [maxPrice, setMaxPrice] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('tickets')
          .select('*')
          .eq('status', 'active')
          .order('created_at', { ascending: false })

        if (!alive) return
        if (error) {
          console.error('[home] tickets load failed:', error.message)
          setTickets([])
          return
        }
        setTickets(data || [])
      } catch (err) {
        console.error('[home] tickets load crashed:', err)
        if (!alive) return
        setTickets([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    let list = [...tickets]
    if (search)    list = list.filter(t => t.title.toLowerCase().includes(search.toLowerCase()) || (t.location || '').toLowerCase().includes(search.toLowerCase()))
    if (category)  list = list.filter(t => t.category === category)
    if (maxPrice)  list = list.filter(t => Number(t.price) <= Number(maxPrice))
    if (sort === 'cheapest') list.sort((a, b) => a.price - b.price)
    if (sort === 'expensive') list.sort((a, b) => b.price - a.price)
    return list
  }, [tickets, search, category, maxPrice, sort])

  function clearFilters() { setSearch(''); setCategory(''); setMaxPrice(''); setSort('newest') }
  const hasFilters = search || category || maxPrice || sort !== 'newest'

  return (
    <div className="page">
      {/* Hero */}
      <div className="home-hero">
        <h1>Find your perfect ticket</h1>
        <p>Concerts, sports, travel and more — all in one place.</p>
        <div className="home-search">
          <input
            type="text"
            placeholder="Search events, artists, cities…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Category pills */}
      <div className="category-pills">
        <button className={`category-pill ${!category ? 'active' : ''}`} onClick={() => setCategory('')}>All</button>
        {CATEGORIES.map(c => (
          <button key={c} className={`category-pill ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
            {CATEGORY_EMOJI[c]} {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="filters-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <label style={{ color: 'var(--muted)', fontSize: '.85rem', whiteSpace: 'nowrap' }}>Max price</label>
            <input
              type="number" min="0" placeholder="Any"
              value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
              style={{ width: 90 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <label style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Sort</label>
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 'auto' }}>
              <option value="newest">Newest</option>
              <option value="cheapest">Cheapest</option>
              <option value="expensive">Most expensive</option>
            </select>
          </div>
          {hasFilters && <button className="btn btn-ghost btn-sm" onClick={clearFilters}>✕ Clear</button>}
        </div>
        <span style={{ color: 'var(--muted)', fontSize: '.85rem', whiteSpace: 'nowrap' }}>
          {loading ? '…' : `${filtered.length} ticket${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="page-loading">Loading tickets…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '3rem' }}>🎟</div>
          <p>{hasFilters ? 'No tickets match your filters.' : 'No tickets listed yet. Be the first!'}</p>
          {hasFilters && <button className="btn btn-outline" style={{ marginTop: '1rem' }} onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <div className="tickets-grid">
          {filtered.map(ticket => <TicketCard key={ticket.id} ticket={ticket} />)}
        </div>
      )}
    </div>
  )
}
