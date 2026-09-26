import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Presage's camera capture generally requires a secure context (HTTPS) or
// localhost. If testing on a real tablet over LAN, use a tool like mkcert
// or tunnel through HTTPS -- confirm this with the Presage SDK docs on
// hour 0, it's the #1 thing that silently blocks the kiosk demo.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
