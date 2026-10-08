import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./tests/browser",
  use:{baseURL:"http://127.0.0.1:3107",channel:"chrome",headless:true},
  webServer:{command:"pnpm exec next dev -p 3107 -H 127.0.0.1",url:"http://127.0.0.1:3107/dev/signature-recipient-focus",reuseExistingServer:false,timeout:120_000},
});
