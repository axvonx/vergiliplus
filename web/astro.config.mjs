import { defineConfig } from "astro/config";

// Flat .html output so the code's sibling "<Type>.html" links resolve within a build dir.
// Component styles (ClientRouter's ~1 KB) go to a cached file, not into every page.
export default defineConfig({
  site: "https://vergiliplus.com",
  build: { format: "file", inlineStylesheets: "never" },
});
