import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IndexAI",
  description: "IndexAI is a platform for finding people with a prompt.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="fixed top-0 left-0 z-50 pl-4 pt-3">
          <Image
            src="/indexai-white-new.png"
            alt="IndexAI Logo"
            width={120}
            height={40}
            priority
            className="h-auto"
          />
        </div>
        {children}
      </body>
    </html>
  );
}
