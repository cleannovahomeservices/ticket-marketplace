import { Link } from 'react-router-dom'
import FavoriteButton from './FavoriteButton'

const CATEGORY_EMOJI = { concerts: '🎵', sports: '⚽', travel: '✈️', events: '🎉', experiences: '🌟' }

export default function TicketCard({ ticket }) {
  const formattedDate = ticket.event_date
    ? new Date(ticket.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const coverImage = ticket.image_urls?.[0] || ticket.image_url || null

  return (
    <div className="ticket-card-wrapper">
      <Link to={`/ticket/${ticket.id}`} className="ticket-card">
        <div className="ticket-card-image">
          {coverImage
            ? <img src={coverImage} alt={ticket.title} loading="lazy" />
            : <div className="ticket-card-no-image">🎟</div>
          }
          <span className={`ticket-badge ticket-badge--${ticket.status}`}>{ticket.status}</span>
          {ticket.category && (
            <span className="ticket-card-category">
              {CATEGORY_EMOJI[ticket.category]}
            </span>
          )}
        </div>
        <div className="ticket-card-body">
          <h3 className="ticket-card-title">{ticket.title}</h3>
          {ticket.category && <p className="ticket-card-cat-label">{ticket.category}</p>}
          {ticket.location && <p className="ticket-card-location">📍 {ticket.location}</p>}
          {formattedDate && <p className="ticket-card-date">📅 {formattedDate}</p>}
          <p className="ticket-card-price">${Number(ticket.price).toFixed(2)}</p>
        </div>
      </Link>
      <div className="ticket-card-fav">
        <FavoriteButton ticketId={ticket.id} />
      </div>
    </div>
  )
}
