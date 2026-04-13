import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Profile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', bio: '' })
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => {
      if (data) {
        setProfile(data)
        setForm({ first_name: data.first_name || '', last_name: data.last_name || '', bio: data.bio || '' })
        setAvatarPreview(data.avatar_url || '')
      }
      setLoading(false)
    })
  }, [user.id])

  function handleChange(e) { setForm(f => ({ ...f, [e.target.name]: e.target.value })) }

  function handleAvatar(e) {
    const file = e.target.files[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    let avatar_url = profile?.avatar_url || null

    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop()
      const path = `avatars/${user.id}.${ext}`
      const { error: upErr } = await supabase.storage.from('tickets').upload(path, avatarFile, { upsert: true })
      if (upErr) { setError(upErr.message); setSaving(false); return }
      const { data } = supabase.storage.from('tickets').getPublicUrl(path)
      avatar_url = data.publicUrl
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      first_name: form.first_name,
      last_name: form.last_name,
      bio: form.bio,
      avatar_url,
      name: `${form.first_name} ${form.last_name}`.trim(),
    })

    if (error) { setError(error.message); setSaving(false); return }
    setProfile(p => ({ ...p, ...form, avatar_url }))
    setMessage('Profile updated!')
    setSaving(false)
  }

  if (loading) return <div className="page-loading">Loading…</div>

  const initials = `${form.first_name.charAt(0)}${form.last_name.charAt(0)}`.toUpperCase() || user.email.charAt(0).toUpperCase()

  return (
    <div className="page" style={{ maxWidth: 600 }}>
      <h1 className="section-title">My Profile</h1>

      <form onSubmit={handleSubmit} className="card">
        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.5rem' }}>
          <div className="avatar-lg" style={{ backgroundImage: avatarPreview ? `url(${avatarPreview})` : 'none' }}>
            {!avatarPreview && initials}
          </div>
          <div>
            <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
              Change photo
              <input type="file" accept="image/*" onChange={handleAvatar} style={{ display: 'none' }} />
            </label>
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.35rem' }}>JPG, PNG or WebP</p>
          </div>
        </div>

        <hr className="divider" />

        {error   && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <div className="form-row">
          <div className="form-group">
            <label>First name *</label>
            <input name="first_name" value={form.first_name} onChange={handleChange} required placeholder="Jane" />
          </div>
          <div className="form-group">
            <label>Last name *</label>
            <input name="last_name" value={form.last_name} onChange={handleChange} required placeholder="Doe" />
          </div>
        </div>

        <div className="form-group">
          <label>Email</label>
          <input value={user.email} disabled style={{ opacity: .6 }} />
        </div>

        <div className="form-group">
          <label>Bio</label>
          <textarea name="bio" value={form.bio} onChange={handleChange} rows={3} placeholder="Tell buyers a bit about yourself…" />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </div>
  )
}
