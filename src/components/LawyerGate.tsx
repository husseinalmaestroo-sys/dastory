"use client";

import { useEffect, useState } from "react";

export type Lawyer = { id: number; name: string; phone: string | null; officeName: string | null };

/**
 * Gates the whole app behind a lightweight identity check — a name (+ phone
 * + office on first visit), no password. This is deliberately NOT a security
 * boundary (anyone who knows a registered name can "log in" as them — there
 * is no secret involved) — its purpose is knowing who is using the assistant
 * and giving /api/chat's rate limit a stable key that survives a cleared
 * cookie, not stopping a determined abuser. See src/lib/lawyer-auth.ts.
 */
export function LawyerGate({
  children,
}: {
  /** Render-prop, not a plain node: the logout control needs to live INSIDE
   *  Chat's own header flex row (see LogoutButton below) so it's a normal,
   *  properly-spaced flex child instead of a `position: fixed` overlay that
   *  has no awareness of Chat's own layout and can end up sitting on top of
   *  it. A plain `{children}` can't receive props this way. */
  children: (lawyer: Lawyer, logout: () => void) => React.ReactNode;
}) {
  const [lawyer, setLawyer] = useState<Lawyer | null | undefined>(undefined); // undefined = still checking
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [officeName, setOfficeName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/lawyer/me")
      .then((r) => r.json())
      .then((d) => setLawyer(d.lawyer))
      .catch(() => setLawyer(null));
  }, []);

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (mode === "login" && name.trim().length < 2) {
      setError("الرجاء إدخال الاسم.");
      return;
    }
    if (mode === "register" && (name.trim().length < 2 || phone.trim().length < 7)) {
      setError("الرجاء إدخال الاسم ورقم الهاتف.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(mode === "login" ? "/api/lawyer/login" : "/api/lawyer/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { name } : { name, phone, officeName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "حدث خطأ. حاول مرة أخرى.");
        return;
      }
      setLawyer(data.lawyer);
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/lawyer/logout", { method: "POST" }).catch(() => {});
    setLawyer(null);
    setName("");
    setPhone("");
    setOfficeName("");
    setMode("login");
  };

  if (lawyer === undefined) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted">جارٍ التحميل...</div>;
  }

  if (lawyer === null) {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-edge bg-panel p-6">
          <h1 className="mb-1 text-center text-sm font-semibold">المساعد القانوني الذكي</h1>
          <p className="mb-5 text-center text-xs text-muted">
            {mode === "login" ? "أدخل اسمك للمتابعة" : "أنشئ حساباً للمتابعة (مرة واحدة فقط)"}
          </p>

          <div className="mb-4 flex rounded-lg border border-edge p-0.5 text-xs">
            <button
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 ${mode === "login" ? "bg-ink text-white" : "text-muted"}`}
            >
              تسجيل الدخول
            </button>
            <button
              onClick={() => {
                setMode("register");
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 ${mode === "register" ? "bg-ink text-white" : "text-muted"}`}
            >
              حساب جديد
            </button>
          </div>

          <div className="space-y-2">
            <input
              className="field w-full"
              placeholder="الاسم الكامل"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {mode === "register" && (
              <>
                <input
                  className="field w-full"
                  placeholder="رقم الهاتف"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
                <input
                  className="field w-full"
                  placeholder="اسم المكتب (اختياري)"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          <button onClick={submit} disabled={busy} className="btn-primary mt-4 w-full py-2 text-sm">
            {busy ? "..." : mode === "login" ? "دخول" : "إنشاء الحساب والدخول"}
          </button>
        </div>
      </div>
    );
  }

  return children(lawyer, logout);
}

/**
 * Meant to be rendered as one more flex child inside Chat.tsx's own header
 * row (alongside the tab-switcher/السجل), not floated independently — that
 * was the previous design and it had no awareness of the header's own
 * content, so it could end up sitting on top of it instead of beside it.
 */
export function LogoutButton({ onLogout, className = "" }: { onLogout: () => void; className?: string }) {
  return (
    <button
      onClick={onLogout}
      title="تسجيل الخروج"
      aria-label="تسجيل الخروج"
      className={`btn-ghost flex items-center justify-center px-2 py-1 ${className}`}
    >
      <LogoutIcon className="h-4 w-4" />
    </button>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    // Mirrored (-scale-x-100): the un-mirrored door+arrow points right, which
    // reads as "in", not "out", once the icon sits in an RTL-flowing row —
    // the arrow needs to point toward the edge a lawyer is leaving through.
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={`-scale-x-100 ${className ?? ""}`}>
      <g stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </g>
    </svg>
  );
}
