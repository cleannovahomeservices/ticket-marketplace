import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) { setProfile(null); return }
    const { data } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, name, avatar_url, role, is_admin, stripe_account_id')
      .eq('id', authUser.id).single()
    setProfile(data || null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      await loadProfile(u)
      setLoading(false)
    })

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

    return () => subscription.unsubscribe()
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
