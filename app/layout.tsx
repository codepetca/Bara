import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { withAuth } from "@workos-inc/authkit-nextjs";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { accessToken: _accessToken, ...initialAuth } = await withAuth();
  void _accessToken;

  return (
    <html lang="en" className={`${geist.variable} ${sora.variable} h-full`}>
      <body className="min-h-full bg-[linear-gradient(180deg,#eef6f3_0%,#f7f8fb_44%,#ffffff_100%)] font-sans text-slate-950 antialiased">
        <AuthKitProvider initialAuth={initialAuth}>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
