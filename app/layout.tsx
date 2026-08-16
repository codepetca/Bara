import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import type { Metadata } from "next";
import { Geist, Sora } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { brand } from "@/config/brand";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: brand.name,
  title: brand.name,
  description: brand.description,
  icons: {
    icon: brand.markPath,
    apple: brand.markPath,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${sora.variable} h-full`}>
      <body className="min-h-full bg-[linear-gradient(180deg,#eef6f3_0%,#f7f8fb_44%,#ffffff_100%)] font-sans text-slate-950 antialiased">
        <AuthKitProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
