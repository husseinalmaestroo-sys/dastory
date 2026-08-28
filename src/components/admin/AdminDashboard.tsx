"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { SourcesManager } from "./SourcesManager";
import { StatsPanel } from "./StatsPanel";
import { ErrorsPanel } from "./ErrorsPanel";

export function AdminDashboard() {
  const [tab, setTab] = useState<"stats" | "sources" | "errors">("stats");
  const router = useRouter();

  const logout = useCallback(async () => {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.refresh();
  }, [router]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-edge px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold">لوحة الإدارة</h1>
            <div className="flex rounded-lg border border-edge p-0.5">
              {(
                [
                  ["stats", "الإحصائيات"],
                  ["sources", "المصادر القانونية"],
                  ["errors", "الأخطاء"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`rounded-md px-3 py-1 text-xs ${tab === k ? "bg-panel text-white" : "text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a href="/" className="btn-ghost px-3 py-1 text-xs">
              الموقع
            </a>
            <button onClick={logout} className="btn-ghost px-3 py-1 text-xs">
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "stats" ? <StatsPanel /> : tab === "sources" ? <SourcesManager /> : <ErrorsPanel />}
      </main>
    </div>
  );
}
