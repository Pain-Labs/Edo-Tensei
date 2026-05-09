import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
    },
  },
})
