import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Flat .html output so the code's sibling "<Type>.html" links resolve within a build dir.
export default defineConfig({
  build: { format: "file" },
  integrations: [preact()],
});
