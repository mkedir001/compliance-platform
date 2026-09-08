import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Workforce Compliance Foundation", description: "Multi-tenant workforce and authorization foundation" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
