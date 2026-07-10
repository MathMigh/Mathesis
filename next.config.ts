import type { NextConfig } from "next";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' ws: wss:",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/lookup": ["./data/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
          {
            key: "Origin-Agent-Cluster",
            value: "?1",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "off",
          },
          {
            key: "X-Permitted-Cross-Domain-Policies",
            value: "none",
          },
          {
            key: "Content-Security-Policy",
            value: CONTENT_SECURITY_POLICY,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
