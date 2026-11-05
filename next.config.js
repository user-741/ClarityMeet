/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 14's built-in lint step doesn't understand ESLint 9 flat config;
  // lint runs separately with `npm run lint`. Type errors still fail the build.
  eslint: { ignoreDuringBuilds: true },
  // Allow dev asset requests when using a cloudflared public URL.
  allowedDevOrigins: [
    'http://localhost:3000',
    'https://*.trycloudflare.com',
  ],
};

module.exports = nextConfig;
