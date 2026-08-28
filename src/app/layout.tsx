import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "المساعد القانوني الذكي | البحث القانوني الأردني",
  description:
    "مساعد بحث قانوني للمحامين يجيب اعتماداً على قاعدة بيانات القوانين والقرارات القضائية المخزّنة حصراً.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-ink">{children}</body>
    </html>
  );
}
