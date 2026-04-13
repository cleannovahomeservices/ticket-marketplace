import { Link } from 'react-router-dom'

export default function TicketCard({ ticket }) {
  const formattedDate = ticket.event_date
    ? new Date(ticket.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <Link to={`/ticket/${ticket.id}`} className="ticket-card">
      <div className="ticket-card-image">
        {ticket.image_url
          ? <img src={ticket.image_url} alt={ticket.title} />
          : <div className="ticket-card-no-image">🎟</div>
        }
        <span className={`ticket-badge ticket-badge--${ticket.status}`}>{ticket.status}</span>
      </div>
      <div className="ticket-card-body">
        <h3 className="ticket-card-title">{ticket.title}</h3>
        {ticket.location && <p className="ticket-card-location">📍 {ticket.location}</p>}
        {formattedDate && <p className="ticket-card-date">📅 {formattedDate}</p>}
        <p className="ticket-card-price">${Number(ticket.price).toFixed(2)}</p>
      </div>
    </Link>
  )
}
