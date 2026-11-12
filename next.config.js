/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 14's built-in lint step doesn't understand ESLint 9 flat config
  eslint: { ignoreDuringBuilds: true },
  // Allow dev asset requests when using a cloudflared public URL.
  allowedDevOrigins: [
    'http://localhost:3000',
    'https://*.trycloudflare.com',
  ],
  // Basic security headers on every page
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), geolocation=()' },
      ],
    }];
  },
};

module.exports = nextConfig;
