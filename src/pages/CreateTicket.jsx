import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const CATEGORIES = ['concerts', 'sports', 'travel', 'events', 'experiences']

export default function CreateTicket() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { user } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    title: '', description: '', price: '',
    event_date: '', event_time: '', location: '', category: 'events',
  })
  const [imageFiles, setImageFiles] = useState([])        // new File objects
  const [existingImages, setExistingImages] = useState([]) // URLs already in DB
  const [ticketFile, setTicketFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    supabase.from('tickets').select('*').eq('id', id).single().then(({ data }) => {
      if (!data || data.seller_id !== user.id) { navigate('/dashboard'); return }
      const dt = data.event_date ? new Date(data.event_date) : null
      setForm({
        title: data.title,
        description: data.description || '',
        price: data.price,
        event_date: dt ? dt.toISOString().slice(0, 10) : '',
        event_time: dt ? dt.toISOString().slice(11, 16) : '',
        location: data.location || '',
        category: data.category || 'events',
      })
      setExistingImages(data.image_urls || (data.image_url ? [data.image_url] : []))
    })
  }, [id, isEdit, user.id, navigate])

  function handleChange(e) { setForm(f => ({ ...f, [e.target.name]: e.target.value })) }

  function handleImages(e) {
    const files = Array.from(e.target.files)
    setImageFiles(prev => [...prev, ...files].slice(0, 5)) // max 5
  }

  function removeNewImage(idx) { setImageFiles(f => f.filter((_, i) => i !== idx)) }
  function removeExisting(idx) { setExistingImages(f => f.filter((_, i) => i !== idx)) }

  async function uploadFile(file, folder) {
    const ext = file.name.split('.').pop()
    const path = `${folder}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('tickets').upload(path, file, { upsert: true })
    if (error) throw error
    return supabase.storage.from('tickets').getPublicUrl(path).data.publicUrl
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!isEdit && imageFiles.length === 0 && existingImages.length === 0) {
      setError('Please add at least one image.')
      return
    }

    setLoading(true)
    try {
      // Upload new images
      const newUrls = await Promise.all(imageFiles.map(f => uploadFile(f, 'images')))
      const image_urls = [...existingImages, ...newUrls]

      // Upload ticket file if provided
      let file_url = undefined
      if (ticketFile) file_url = await uploadFile(ticketFile, 'files')

      // Combine date + time
      let event_date = null
      if (form.event_date) {
        event_date = form.event_time
          ? `${form.event_date}T${form.event_time}:00`
          : `${form.event_date}T00:00:00`
      }

      const payload = {
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        event_date,
        location: form.location,
        category: form.category,
        image_urls,
        image_url: image_urls[0] || null, // backwards compat
        ...(file_url !== undefined && { file_url }),
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

  const totalImages = existingImages.length + imageFiles.length

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="section-title">{isEdit ? 'Edit Listing' : 'Sell a Ticket'}</h1>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="card">
        {/* Basic info */}
        <div className="form-group">
          <label>Title *</label>
          <input name="title" value={form.title} onChange={handleChange} required placeholder="e.g. Taylor Swift – Madrid, June 14" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={form.category} onChange={handleChange} required>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Price (USD) *</label>
            <input name="price" type="number" min="0" step="0.01" value={form.price} onChange={handleChange} required placeholder="0.00" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Event date</label>
            <input name="event_date" type="date" value={form.event_date} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Event time</label>
            <input name="event_time" type="time" value={form.event_time} onChange={handleChange} />
          </div>
        </div>

        <div className="form-group">
          <label>Location</label>
          <input name="location" value={form.location} onChange={handleChange} placeholder="City, venue…" />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea name="description" value={form.description} onChange={handleChange} rows={4} placeholder="Seat number, zone, face value, any extra details…" />
        </div>

        <hr className="divider" />

        {/* Images */}
        <div className="form-group">
          <label>
            Images * <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '.82rem' }}>({totalImages}/5 — first image is the cover)</span>
          </label>

          {totalImages > 0 && (
            <div className="image-preview-grid">
              {existingImages.map((url, i) => (
                <div key={`ex-${i}`} className="image-preview-thumb">
                  <img src={url} alt="" />
                  {i === 0 && <span className="thumb-cover">Cover</span>}
                  <button type="button" className="thumb-remove" onClick={() => removeExisting(i)}>✕</button>
                </div>
              ))}
              {imageFiles.map((file, i) => (
                <div key={`new-${i}`} className="image-preview-thumb">
                  <img src={URL.createObjectURL(file)} alt="" />
                  {existingImages.length === 0 && i === 0 && <span className="thumb-cover">Cover</span>}
                  <button type="button" className="thumb-remove" onClick={() => removeNewImage(i)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {totalImages < 5 && (
            <label className="file-upload-area">
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImages} style={{ display: 'none' }} />
              <span>📷 Click to add images</span>
            </label>
          )}
        </div>

        {/* Ticket file */}
        <div className="form-group">
          <label>Ticket file (PDF / image) — optional</label>
          <label className="file-upload-area" style={{ padding: '.75rem' }}>
            <input type="file" accept=".pdf,image/*" onChange={e => setTicketFile(e.target.files[0])} style={{ display: 'none' }} />
            <span>{ticketFile ? `📄 ${ticketFile.name}` : '📄 Upload ticket file'}</span>
          </label>
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%', marginTop: '.5rem' }}>
          {loading ? 'Saving…' : isEdit ? 'Save changes' : 'List ticket'}
        </button>
      </form>
    </div>
  )
}
