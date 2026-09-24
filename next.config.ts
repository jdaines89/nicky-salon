import type { NextConfig } from "next";

// A static site: every page is plain HTML and JS that talks to Supabase from
// the browser, so it is served free from GitHub Pages and never goes to sleep.
// Security lives in the database (row-level security), not in a server.
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
