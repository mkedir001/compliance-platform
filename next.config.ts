import type { NextConfig } from "next";
const securityHeaders = [
  { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; connect-src 'self'` },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];
const nextConfig: NextConfig = { poweredByHeader: false, async headers(){return[{source:"/:path*",headers:securityHeaders},{source:"/api/sign/:token/document",headers:[{key:"Content-Security-Policy",value:"default-src 'none'; frame-ancestors 'self'"},{key:"X-Frame-Options",value:"SAMEORIGIN"},{key:"Referrer-Policy",value:"no-referrer"}]}]} };
export default nextConfig;
