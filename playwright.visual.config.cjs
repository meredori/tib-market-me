const { defineConfig, devices } = require('@playwright/test')

const devCommand = process.platform === 'win32'
  ? 'npm.cmd run dev:inspect'
  : 'npm run dev:inspect'

module.exports = defineConfig({
  testDir: './tests/visual',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: false,
  workers: 1,
  outputDir: 'ui-app/test-artifacts/visual/current',
  snapshotPathTemplate: 'ui-app/test-artifacts/visual/baseline/{projectName}/{arg}{ext}',
  webServer: {
    command: devCommand,
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1100 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 852 },
      },
    },
  ],
})
