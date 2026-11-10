import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // /api/home goes to the loopback home app; the rest (pay page, phone) to the public app.
  server: { proxy: { '/api/home': 'http://127.0.0.1:8787', '/api': 'http://127.0.0.1:8788' } },
});
