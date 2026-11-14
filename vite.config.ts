import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // In live mode the app calls `/api`, which is passed to the CRM server, so the browser sees one origin.
  server: { port: 5183, strictPort: true, proxy: { '/api': 'http://localhost:5184' } },
});
