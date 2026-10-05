import type { NextConfig } from "next";

// Sites allowed to put this tool in an iframe. Set EMBED_ORIGINS to a space
// separated list to change it. Everyone else is refused, which stops
// clickjacking, while the Rothenhall site can embed the tool.
const embedOrigins = (
  process.env.EMBED_ORIGINS ?? "https://rothenhall.com https://www.rothenhall.com"
).trim();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${embedOrigins}`,
          },
          // The call needs the microphone. Without this, an embedded copy
          // would be refused it. The embedding page must also say allow="microphone".
          { key: "Permissions-Policy", value: "microphone=(self)" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
