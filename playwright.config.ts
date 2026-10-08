import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./tests/browser",
  use:{baseURL:"http://localhost:3107",channel:"chrome",headless:true},
  webServer:{command:"PORT=3107 pnpm visual-qa:dev",url:"http://localhost:3107/dev/signature-recipient-focus",reuseExistingServer:true,timeout:120_000},
});
