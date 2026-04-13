import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function FavoriteButton({ ticketId, count: initialCount = 0 }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('favorites')
      .select('user_id', { count: 'exact' })
      .eq('ticket_id', ticketId)
      .then(({ count: total }) => setCount(total || 0))

    supabase
      .from('favorites')
      .select('user_id')
      .eq('ticket_id', ticketId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setLiked(!!data))
  }, [ticketId, user])

  async function toggle(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!user) { navigate('/login'); return }
    setLoading(true)
    if (liked) {
      await supabase.from('favorites').delete().eq('ticket_id', ticketId).eq('user_id', user.id)
      setLiked(false)
      setCount(c => Math.max(0, c - 1))
    } else {
      await supabase.from('favorites').insert({ ticket_id: ticketId, user_id: user.id })
      setLiked(true)
      setCount(c => c + 1)
    }
    setLoading(false)
  }

  return (
    <button className={`fav-btn ${liked ? 'fav-btn--liked' : ''}`} onClick={toggle} disabled={loading} title={liked ? 'Remove from favorites' : 'Add to favorites'}>
      {liked ? '❤️' : '🤍'}
      {count > 0 && <span className="fav-count">{count}</span>}
    </button>
  )
}
