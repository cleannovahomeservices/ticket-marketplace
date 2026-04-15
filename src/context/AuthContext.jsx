import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [favoriteIds, setFavoriteIds] = useState(() => new Set())
  const lastProfileUserId = useRef(null)

  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) { setProfile(null); lastProfileUserId.current = null; return }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, first_name, last_name, name, avatar_url, role, is_admin, stripe_account_id')
        .eq('id', authUser.id).single()
      if (error) {
        console.error('[auth] profile load failed:', error.message)
        setProfile(null)
        return
      }
      setProfile(data || null)
      lastProfileUserId.current = authUser.id
    } catch (err) {
      console.error('[auth] profile load crashed:', err)
      setProfile(null)
    }
  }, [])

  const loadFavorites = useCallback(async (authUser) => {
    if (!authUser) { setFavoriteIds(new Set()); return }
    try {
      const { data, error } = await supabase
        .from('favorites').select('ticket_id').eq('user_id', authUser.id)
      if (error) { console.error('[auth] favorites load failed:', error.message); return }
      setFavoriteIds(new Set((data || []).map(f => f.ticket_id)))
    } catch (err) {
      console.error('[auth] favorites load crashed:', err)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const u = session?.user ?? null
        if (!alive) return
        setUser(u)
        await Promise.all([loadProfile(u), loadFavorites(u)])
      } catch (err) {
        console.error('[auth] initial session load failed:', err)
        if (!alive) return
        setUser(null)
        setProfile(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()

    // CRITICAL: never use `await` inside this callback — it deadlocks the
    // Supabase client (known issue #936). Fire-and-forget via setTimeout
    // so control returns to the auth lock immediately.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      setUser(u)

      if (event === 'SIGNED_OUT' || !u) {
        setProfile(null)
        setFavoriteIds(new Set())
        lastProfileUserId.current = null
        return
      }

      // Skip redundant reloads: INITIAL_SESSION and TOKEN_REFRESHED don't
      // change user identity, and we already loaded the profile in init.
      if (event === 'TOKEN_REFRESHED') return
      if (event === 'INITIAL_SESSION' && lastProfileUserId.current === u.id) return

      setTimeout(() => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          supabase.from('profiles').upsert({
            id: u.id,
            email: u.email,
            name: u.user_metadata?.full_name || u.user_metadata?.name || null,
            avatar_url: u.user_metadata?.avatar_url || null,
          }, { onConflict: 'id', ignoreDuplicates: true }).then(() => {
            loadProfile(u)
            loadFavorites(u)
          })
        } else {
          loadProfile(u)
          loadFavorites(u)
        }
      }, 0)
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [loadProfile, loadFavorites])

  const role = profile?.role || (profile?.is_admin ? 'admin' : 'user')
  const isAdmin = role === 'admin'

  const toggleFavorite = useCallback((ticketId, liked) => {
    setFavoriteIds(prev => {
      const next = new Set(prev)
      if (liked) next.add(ticketId); else next.delete(ticketId)
      return next
    })
  }, [])

  return (
    <AuthContext.Provider value={{
      user, profile, role, isAdmin, loading,
      favoriteIds, toggleFavorite,
      refreshProfile: () => loadProfile(user),
      refreshFavorites: () => loadFavorites(user),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
