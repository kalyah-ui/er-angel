import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The kiosk doesn't open the camera itself: the Presage agent
// (presage-agent/, http://localhost:4600) owns the webcam, so no HTTPS /
// secure-context setup is needed for camera access here.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
