/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: Next.js traces the exact node_modules subset this app
  // needs into .next/standalone, so the Docker image doesn't need to ship
  // the whole monorepo's node_modules. See Dockerfile.
  output: 'standalone',
};

module.exports = nextConfig;
