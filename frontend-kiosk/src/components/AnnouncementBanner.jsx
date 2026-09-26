/** Full-width, high-contrast PA banner. Shows the patient number only -- never a name. */
export default function AnnouncementBanner({ banner }) {
  if (!banner) return null;
  return (
    <div
      key={banner.id}
      className={`announcement announcement-${banner.type}`}
      role="alert"
      aria-live="assertive"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="announcement-label">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M3 10v4h3l5 4V6L6 10H3zm13-3v10M19 5v14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
        Announcement
      </span>
      <p className="announcement-text">{banner.text}</p>
    </div>
  );
}
