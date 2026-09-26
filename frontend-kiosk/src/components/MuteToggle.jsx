export default function MuteToggle({ muted, onToggle }) {
  return (
    <button
      className="mute-toggle"
      onClick={(e) => {
        // Don't let the tap reach the screen behind (e.g. "tap anywhere to check in").
        e.stopPropagation();
        onToggle();
      }}
      aria-label={muted ? "Unmute voice guidance" : "Mute voice guidance"}
      aria-pressed={muted}
      title={muted ? "Voice off" : "Voice on"}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        ) : (
          <path
            d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
    </button>
  );
}
