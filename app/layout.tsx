import type React from "react"
import type { Metadata, Viewport } from "next"
import { AppProviders } from "@/components/app-providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "NewsHub - 개발자를 위한 IT 뉴스",
  description: "IT·과학 뉴스와 기술 산업의 흐름을 읽고, 기사 원문과 공식 기술 소식을 함께 확인하세요.",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f1419",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`font-sans antialiased`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
