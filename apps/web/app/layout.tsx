import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ServicePilot | Products and customer support", template: "%s | ServicePilot" },
  description: "Browse products, manage your cart, track orders, and contact authenticated customer support.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f6f2" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = (await cookies()).get("sp_lang")?.value === "en" ? "en" : "th";
  return <html lang={language}><body>{children}</body></html>;
}
