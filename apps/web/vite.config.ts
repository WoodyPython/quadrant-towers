import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(
    mode,
    fileURLToPath(new URL('../../', import.meta.url)),
    '',
  );
  const host =
    environment.HOST === '0.0.0.0'
      ? '127.0.0.1'
      : environment.HOST || '127.0.0.1';
  const target = `http://${host}:${environment.PORT || '3000'}`;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': target, '/health': target },
    },
  };
});
