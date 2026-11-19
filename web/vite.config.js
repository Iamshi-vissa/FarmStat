import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // long-lived vendor files: they rarely change, so browsers keep them cached between releases
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/react-dom|scheduler|\/react\//.test(id)) return 'react';
          return undefined;
        }
      }
    }
  }
});
