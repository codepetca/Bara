import { ClerkProvider } from "@clerk/nextjs";
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
        <ClerkProvider
          localization={{
            signIn: {
              start: {
                title: brand.name,
                titleCombined: brand.name,
                subtitle: brand.authTagline,
                subtitleCombined: brand.authTagline,
                actionText: "",
                actionLink: "Create a new account",
              },
              password: {
                title: brand.name,
                subtitle: brand.authTagline,
              },
              emailCode: {
                title: brand.name,
                subtitle: brand.authTagline,
                formTitle: "",
              },
              forgotPassword: {
                title: brand.name,
                subtitle: brand.authTagline,
                subtitle_email: brand.authTagline,
                subtitle_phone: brand.authTagline,
                formTitle: "",
              },
              resetPassword: {
                title: brand.name,
              },
            },
            signUp: {
              start: {
                title: brand.name,
                subtitle: brand.authTagline,
                actionText: "",
                actionLink: "Sign in",
              },
              continue: {
                title: brand.name,
                subtitle: brand.authTagline,
                actionText: "",
                actionLink: "",
              },
              emailCode: {
                title: brand.name,
                subtitle: brand.authTagline,
                formTitle: "",
                formSubtitle: "",
              },
              emailLink: {
                title: brand.name,
                subtitle: brand.authTagline,
                formTitle: "",
                formSubtitle: "",
              },
            },
          }}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
