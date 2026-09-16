import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  // Server .env is only needed for the development proxy. Loading its
  // NODE_ENV during a build would silently compile React in development mode.
  const environment =
    command === 'serve'
      ? loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), '')
      : {};
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
      proxy: {
        '/api': target,
        '/health': target,
        '/socket.io': { target, ws: true },
      },
    },
  };
});
