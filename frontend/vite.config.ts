import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under /<repository-name>/. The workflow passes it in, so the
  // build works under any account or repository name; '/feu-bataan-erfa/' is the local default.
  base: process.env.VITE_BASE_PATH || '/feu-bataan-erfa/',
  build: {
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      // auth-redirect.html is where the Microsoft sign-in pop-up returns (see microsoftSignIn.tsx).
      input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), authRedirect: fileURLToPath(new URL('./auth-redirect.html', import.meta.url)) },
      output: {
        // Keep rarely-changing libraries in their own long-cached chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('lucide-react')) return 'icons';
          if (/[/\\](react|react-dom|react-router|react-router-dom|scheduler)[/\\]/.test(id)) return 'vendor';
          return undefined;
        }
      }
    }
  }
});
