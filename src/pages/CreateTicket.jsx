import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function CreateTicket() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { user } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ title: '', description: '', price: '', event_date: '', location: '' })
  const [imageFile, setImageFile] = useState(null)
  const [ticketFile, setTicketFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    supabase.from('tickets').select('*').eq('id', id).single().then(({ data }) => {
      if (!data || data.seller_id !== user.id) { navigate('/dashboard'); return }
      setForm({
        title: data.title,
        description: data.description || '',
        price: data.price,
        event_date: data.event_date ? data.event_date.slice(0, 16) : '',
        location: data.location || '',
      })
      setImagePreview(data.image_url || '')
    })
  }, [id, isEdit, user.id, navigate])

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function handleImage(e) {
    const file = e.target.files[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  async function uploadFile(file, folder) {
    const ext = file.name.split('.').pop()
    const path = `${folder}/${user.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('tickets').upload(path, file, { upsert: true })
    if (error) throw error
    const { data } = supabase.storage.from('tickets').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      let image_url = imagePreview
      let file_url = null

      if (imageFile) image_url = await uploadFile(imageFile, 'images')
      if (ticketFile) file_url = await uploadFile(ticketFile, 'files')

      const payload = {
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        event_date: form.event_date || null,
        location: form.location,
        image_url,
        ...(file_url && { file_url }),
      }

      if (isEdit) {
        const { error } = await supabase.from('tickets').update(payload).eq('id', id)
        if (error) throw error
        navigate(`/ticket/${id}`)
      } else {
        const { data, error } = await supabase.from('tickets').insert({ ...payload, seller_id: user.id, status: 'active' }).select().single()
        if (error) throw error
        navigate(`/ticket/${data.id}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <h1 className="section-title">{isEdit ? 'Edit Listing' : 'Sell a Ticket'}</h1>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="card">
        <div className="form-group">
          <label>Title *</label>
          <input name="title" value={form.title} onChange={handleChange} required placeholder="e.g. Taylor Swift – Madrid, June 14" />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea name="description" value={form.description} onChange={handleChange} rows={4} placeholder="Seat number, zone, any extra details…" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Price (USD) *</label>
            <input name="price" type="number" min="0" step="0.01" value={form.price} onChange={handleChange} required placeholder="0.00" />
          </div>
          <div className="form-group">
            <label>Event date</label>
            <input name="event_date" type="datetime-local" value={form.event_date} onChange={handleChange} />
          </div>
        </div>

        <div className="form-group">
          <label>Location</label>
          <input name="location" value={form.location} onChange={handleChange} placeholder="City, venue…" />
        </div>

        <hr className="divider" />

        <div className="form-group">
          <label>Ticket image (JPG / PNG)</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImage} />
          {imagePreview && <img src={imagePreview} alt="preview" style={{ marginTop: '.5rem', borderRadius: 8, maxHeight: 160, objectFit: 'cover' }} />}
        </div>

        <div className="form-group">
          <label>Ticket file (PDF / image)</label>
          <input type="file" accept=".pdf,image/*" onChange={e => setTicketFile(e.target.files[0])} />
          {ticketFile && <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: '.25rem' }}>Selected: {ticketFile.name}</p>}
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%', marginTop: '.5rem' }}>
          {loading ? 'Saving…' : isEdit ? 'Save changes' : 'List ticket'}
        </button>
      </form>
    </div>
  )
}
