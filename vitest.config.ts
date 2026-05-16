import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/core/extractors/CodexExtractor.ts',
        'src/core/PathInference.ts',
        'src/core/SessionSearchEngine.ts',
        'src/core/TimeFilter.ts',
      ],
      exclude: ['src/test/**'],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
    },
  },
})
