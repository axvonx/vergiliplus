import { defineConfig } from "astro/config";

// Flat .html output so the code's sibling "<Type>.html" links resolve within a build dir.
export default defineConfig({
  site: "https://vergiliplus.com",
  build: { format: "file" },
});
