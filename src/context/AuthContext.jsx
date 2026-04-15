import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) { setProfile(null); return }
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
    } catch (err) {
      console.error('[auth] profile load crashed:', err)
      setProfile(null)
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
        await loadProfile(u)
      } catch (err) {
        console.error('[auth] initial session load failed:', err)
        if (!alive) return
        setUser(null)
        setProfile(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user ?? null
      setUser(u)

      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && u) {
        await supabase.from('profiles').upsert({
          id: u.id,
          email: u.email,
          name: u.user_metadata?.full_name || u.user_metadata?.name || null,
          avatar_url: u.user_metadata?.avatar_url || null,
        }, { onConflict: 'id', ignoreDuplicates: true })
      }

      await loadProfile(u)
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const role = profile?.role || (profile?.is_admin ? 'admin' : 'user')
  const isAdmin = role === 'admin'

  return (
    <AuthContext.Provider value={{ user, profile, role, isAdmin, loading, refreshProfile: () => loadProfile(user) }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
