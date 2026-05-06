import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const statusProxy = {
  '/status-proxy': {
    target: 'https://status.yandex.cloud',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/status-proxy/, '/api'),
  },
} as const;

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
  server: { proxy: { ...statusProxy } },
  preview: { proxy: { ...statusProxy } },
});
