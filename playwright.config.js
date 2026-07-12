const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "python -m uvicorn graphrag_pipeline.api_server:app --host 127.0.0.1 --port 8765",
    url: "http://127.0.0.1:8765/api/v1/health",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      SILICONFLOW_API_KEY: "",
      ENABLE_LANGEXTRACT: "0",
      GRAPHRAG_DATA_DIR: path.resolve("output/playwright/test-data"),
    },
  },
});
