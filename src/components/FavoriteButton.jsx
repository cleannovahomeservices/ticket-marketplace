import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function FavoriteButton({ ticketId }) {
  const { user, favoriteIds, toggleFavorite } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const liked = favoriteIds?.has(ticketId) || false

  async function toggle(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!user) { navigate('/login'); return }
    setLoading(true)
    // Optimistic update — flip state immediately, revert on error.
    toggleFavorite(ticketId, !liked)
    const { error } = liked
      ? await supabase.from('favorites').delete().eq('ticket_id', ticketId).eq('user_id', user.id)
      : await supabase.from('favorites').insert({ ticket_id: ticketId, user_id: user.id })
    if (error) toggleFavorite(ticketId, liked)
    setLoading(false)
  }

  return (
    <button className={`fav-btn ${liked ? 'fav-btn--liked' : ''}`} onClick={toggle} disabled={loading} title={liked ? 'Remove from favorites' : 'Add to favorites'}>
      {liked ? '❤️' : '🤍'}
    </button>
  )
}
