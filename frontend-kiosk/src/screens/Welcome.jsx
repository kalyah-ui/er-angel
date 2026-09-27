export default function Welcome({ onCheckIn, onRescan }) {
  return (
    <main className="screen welcome" onClick={onCheckIn}>
      <div className="welcome-center">
        <p className="brand">ER Angel</p>
        <h1>Welcome</h1>
        <p className="lead">Tap anywhere to check in</p>
      </div>
      <button
        className="secondary"
        onClick={(e) => {
          e.stopPropagation();
          onRescan();
        }}
      >
        Already checked in? Tap here for your follow-up check
      </button>
    </main>
  );
}
