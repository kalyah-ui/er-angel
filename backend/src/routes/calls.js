import { Router } from "express";
import { markAnnounced, pendingCalls } from "../services/calls.js";

export const callsRouter = Router();

// GET /calls/pending -- polled by the kiosk; triage calls first
callsRouter.get("/pending", (req, res) => {
  res.json(pendingCalls());
});

// POST /calls/:id/announced -- kiosk finished announcing this call
callsRouter.post("/:id/announced", (req, res) => {
  const call = markAnnounced(req.params.id);
  if (!call) return res.status(404).json({ error: "call not found" });
  res.json(call);
});
