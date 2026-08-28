"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      // Server component re-runs and now sees the cookie.
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "تعذّر تسجيل الدخول.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">لوحة الإدارة</h1>
        <p className="mt-1 text-xs text-muted">أدخل كلمة مرور الإدارة للمتابعة.</p>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="كلمة المرور"
          className="field mt-4"
        />

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <button type="submit" disabled={busy || !password} className="btn-primary mt-4 w-full">
          {busy ? "..." : "دخول"}
        </button>
      </form>
    </div>
  );
}
