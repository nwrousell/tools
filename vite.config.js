import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';

// Auto-discover HTML entry points in tool directories
function discoverEntryPoints() {
  const entries = {
    main: resolve(__dirname, 'index.html'),
  };

  for (const name of readdirSync(__dirname)) {
    const dir = resolve(__dirname, name);
    const html = resolve(dir, 'index.html');
    if (
      statSync(dir).isDirectory() &&
      !name.startsWith('.') &&
      !name.startsWith('node_modules') &&
      existsSync(html)
    ) {
      entries[name] = html;
    }
  }

  return entries;
}

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: discoverEntryPoints(),
    },
  },
});
