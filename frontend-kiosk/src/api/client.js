const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export async function checkIn({ name, chief_complaint }) {
  const res = await fetch(`${BASE_URL}/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, chief_complaint }),
  });
  if (!res.ok) throw new Error("check-in failed");
  return res.json();
}

export async function submitReading({ patient_id, heart_rate, breathing_rate, stress_score, is_baseline }) {
  const res = await fetch(`${BASE_URL}/reading`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id, heart_rate, breathing_rate, stress_score, is_baseline }),
  });
  if (!res.ok) throw new Error("reading submission failed");
  return res.json();
}
