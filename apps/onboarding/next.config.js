const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  // Inline NEXT_PUBLIC_CODER_URL at build time so the client bundle can link
  // to the Coder dashboard without an extra round-trip. Falls back to the
  // local default when not provided.
  env: {
    NEXT_PUBLIC_CODER_URL: process.env.CODER_PUBLIC_URL ?? 'http://localhost:7080',
  },
};

module.exports = nextConfig;
