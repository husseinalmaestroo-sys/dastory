import type { Metadata } from 'next'
import './fonts.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'دُسْتُورِي — المنصة القانونية السحابية الأولى في الأردن',
  description: 'نظام سحابي متكامل لإدارة مكاتب وشركات المحاماة الأردنية',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230F172A'/%3E%3Cline x1='32' y1='10' x2='32' y2='54' stroke='%23C8A84B' stroke-width='3' stroke-linecap='round'/%3E%3Cline x1='14' y1='20' x2='50' y2='20' stroke='%23C8A84B' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='14' cy='28' r='7' fill='none' stroke='%23C8A84B' stroke-width='2.5'/%3E%3Ccircle cx='50' cy='28' r='7' fill='none' stroke='%23C8A84B' stroke-width='2.5'/%3E%3Cline x1='22' y1='54' x2='42' y2='54' stroke='%23C8A84B' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preload" href="/fonts/cairo/cairo-arabic-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  )
}
