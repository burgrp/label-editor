import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'font-awesome-license',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'fontawesome-license.txt',
          source: readFileSync(
            new URL('./node_modules/@fortawesome/fontawesome-free/LICENSE.txt', import.meta.url),
            'utf8',
          ),
        })
      },
    },
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
