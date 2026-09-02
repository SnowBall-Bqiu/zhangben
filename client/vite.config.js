import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(rootDir, 'VERSION'), 'utf8').trim();

if (!/^v\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`VERSION must use the vX.X.X format; found: ${version}`);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const serverPort = env.PORT || '3000';

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(version)
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist'
    }
  };
});
