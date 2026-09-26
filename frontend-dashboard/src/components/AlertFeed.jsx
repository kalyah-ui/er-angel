export default function AlertFeed({ alerts, onAcknowledge }) {
  const active = alerts.filter((a) => !a.acknowledged);

  if (!active.length) {
    return <p className="empty">No active alerts.</p>;
  }

  return (
    <ul className="alert-feed">
      {active.map((a) => (
        <li key={a.id} className={`alert-item risk-${a.risk_level}`}>
          <span>{a.reason_text}</span>
          <button onClick={() => onAcknowledge(a.id)}>Acknowledge</button>
        </li>
      ))}
    </ul>
  );
}
