'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type AuthMode = 'login' | 'signup' | '2fa' | 'forgot' | 'reset'

export default function LoginClient({ initialResetToken }: { initialResetToken: string }) {
  const router = useRouter()
  const [authMode, setAuthMode] = useState<AuthMode>(initialResetToken ? 'reset' : 'login')
  const [loginBusy, setLoginBusy] = useState(false)
  const [signupBusy, setSignupBusy] = useState(false)
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorUser, setTwoFactorUser] = useState<{ email: string; name?: string } | null>(null)
  const [loginError, setLoginError] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [resetToken] = useState(initialResetToken)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [signupForm, setSignupForm] = useState({ name: '', officeName: '', email: '', password: '', phone: '', barNumber: '' })
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // Strip ?resetToken= from the URL bar once consumed. Deliberately the raw
  // History API, not router.replace(): router.replace() re-runs the /login
  // server component, which (with the token gone) would re-apply the
  // redirect-if-already-authenticated check and blow away the in-progress
  // reset form. history.replaceState only edits the visible URL — no
  // navigation, no re-render, matching the pre-refactor behavior exactly.
  useEffect(() => {
    if (initialResetToken) window.history.replaceState({}, '', '/login')
  }, [initialResetToken])

  const login = async () => {
    const email = emailRef.current?.value?.trim()
    const password = passwordRef.current?.value
    if (!email || !password) { setLoginError('أدخل البريد وكلمة المرور'); return }
    setLoginBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'خطأ في الدخول'); return }
      if (data.requires2FA) {
        setTwoFactorUser(data.user ?? { email })
        setTwoFactorCode('')
        setAuthMode('2fa')
        return
      }
      if (data.user?.role === 'CITIZEN') { router.push('/citizen'); return }
      router.push('/dashboard')
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setLoginBusy(false)
    }
  }

  const verifyTwoFactor = async () => {
    if (!twoFactorCode.trim()) { setLoginError('أدخل رمز التحقق'); return }
    setTwoFactorBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFactorCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'رمز التحقق غير صحيح'); return }
      if (data.user?.role === 'CITIZEN') { router.push('/citizen'); return }
      router.push('/dashboard')
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  const updateSignup = (key: keyof typeof signupForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSignupForm((form) => ({ ...form, [key]: e.target.value }))
  }

  const signup = async () => {
    if (!signupForm.name.trim()) { setLoginError('أدخل الاسم الكامل'); return }
    if (!signupForm.email.trim() || !signupForm.email.includes('@')) { setLoginError('أدخل بريداً إلكترونياً صحيحاً'); return }
    if (signupForm.password.length < 8) { setLoginError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return }

    setSignupBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...signupForm,
          email: signupForm.email.toLowerCase().trim(),
          officeName: signupForm.officeName.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'تعذر إنشاء الحساب'); return }
      router.push('/dashboard')
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setSignupBusy(false)
    }
  }

  const requestReset = async () => {
    if (!forgotEmail.trim() || !forgotEmail.includes('@')) { setLoginError('أدخل بريداً إلكترونياً صحيحاً'); return }
    setForgotBusy(true); setLoginError('')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'تعذر إرسال الطلب'); return }
      setForgotSent(true)
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setForgotBusy(false)
    }
  }

  const submitReset = async () => {
    if (resetPassword.length < 8) { setLoginError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return }
    if (resetPassword !== resetConfirm) { setLoginError('كلمتا المرور غير متطابقتين'); return }
    setResetBusy(true); setLoginError('')
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: resetPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'تعذر إعادة تعيين كلمة المرور'); return }
      setResetDone(true)
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div id="dboard-body">
      <div id="login-screen">
        <div className="lcard">
          <div className="llogo">
            <div className="brand">دُسْتُورِي</div>
            <div className="sub">
              {authMode === 'login' ? 'منظومة المحامي الذكي'
                : authMode === 'signup' ? 'إنشاء مكتب جديد'
                : authMode === 'forgot' ? 'استعادة كلمة المرور'
                : authMode === 'reset' ? 'تعيين كلمة مرور جديدة'
                : 'رمز المصادقة الثنائية'}
            </div>
          </div>

          {authMode === 'forgot' ? (
            forgotSent ? (
              <div style={{ color: '#10B981', fontSize: '.85rem', textAlign: 'center', lineHeight: 1.8, padding: '10px 0' }}>
                ✅ إذا كان هذا البريد مسجلاً لدينا، سيصلك رابط لإعادة تعيين كلمة المرور خلال دقائق. تحقق من صندوق الوارد.
              </div>
            ) : (
              <div className="lf">
                <label>البريد الإلكتروني</label>
                <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="example@lawfirm.jo" autoComplete="username" onKeyDown={(e) => e.key === 'Enter' && requestReset()} />
              </div>
            )
          ) : authMode === 'reset' ? (
            resetDone ? (
              <div style={{ color: '#10B981', fontSize: '.85rem', textAlign: 'center', lineHeight: 1.8, padding: '10px 0' }}>
                ✅ تم تعيين كلمة المرور الجديدة بنجاح. يمكنك الآن تسجيل الدخول بها.
              </div>
            ) : (
              <>
                <div className="lf">
                  <label>كلمة المرور الجديدة</label>
                  <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="8 أحرف على الأقل" autoComplete="new-password" />
                </div>
                <div className="lf">
                  <label>تأكيد كلمة المرور</label>
                  <input type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="أعد كتابة كلمة المرور" autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && submitReset()} />
                </div>
              </>
            )
          ) : authMode === 'login' ? (
            <>
              <div className="lf">
                <label>البريد الإلكتروني</label>
                <input ref={emailRef} type="email" placeholder="example@lawfirm.jo" autoComplete="username" />
              </div>
              <div className="lf">
                <label>كلمة المرور</label>
                <input ref={passwordRef} type="password" placeholder="••••••••••" autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && login()} />
              </div>
              <button
                type="button"
                onClick={() => { setLoginError(''); setForgotSent(false); setAuthMode('forgot') }}
                style={{ marginTop: -6, marginBottom: 10, background: 'none', border: 'none', color: '#94A3B8', fontFamily: "'Cairo', sans-serif", fontSize: '.76rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                نسيت كلمة المرور؟
              </button>
            </>
          ) : authMode === 'signup' ? (
            <>
              <div className="lf">
                <label>الاسم الكامل</label>
                <input value={signupForm.name} onChange={updateSignup('name')} placeholder="اسم المحامي / المدير" autoComplete="name" />
              </div>
              <div className="lf">
                <label>اسم المكتب</label>
                <input value={signupForm.officeName} onChange={updateSignup('officeName')} placeholder="اختياري للمحامي المستقل" />
              </div>
              <div className="lf">
                <label>البريد الإلكتروني</label>
                <input value={signupForm.email} onChange={updateSignup('email')} type="email" placeholder="example@lawfirm.jo" autoComplete="username" />
              </div>
              <div className="lf">
                <label>كلمة المرور</label>
                <input value={signupForm.password} onChange={updateSignup('password')} type="password" placeholder="8 أحرف على الأقل" autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && signup()} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="lf">
                  <label>الهاتف</label>
                  <input value={signupForm.phone} onChange={updateSignup('phone')} placeholder="اختياري" />
                </div>
                <div className="lf">
                  <label>رقم النقابة</label>
                  <input value={signupForm.barNumber} onChange={updateSignup('barNumber')} placeholder="اختياري" />
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ color: '#94A3B8', fontSize: '.82rem', textAlign: 'center', lineHeight: 1.7, marginBottom: 14 }}>
                أدخل الرمز من تطبيق المصادقة لحساب {twoFactorUser?.email ?? 'المستخدم'}.
              </div>
              <div className="lf">
                <label>رمز التحقق</label>
                <input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" autoComplete="one-time-code" onKeyDown={(e) => e.key === 'Enter' && verifyTwoFactor()} />
              </div>
            </>
          )}

          {loginError && <div style={{ color: '#EF4444', fontSize: 13, textAlign: 'center', marginBottom: 4 }}>{loginError}</div>}

          {authMode === 'forgot' ? (
            !forgotSent && (
              <button className="btn-login" onClick={requestReset} disabled={forgotBusy}>{forgotBusy ? 'جارٍ الإرسال...' : 'إرسال رابط إعادة التعيين'}</button>
            )
          ) : authMode === 'reset' ? (
            !resetDone && (
              <button className="btn-login" onClick={submitReset} disabled={resetBusy}>{resetBusy ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور الجديدة'}</button>
            )
          ) : (
            <button className="btn-login" onClick={authMode === 'login' ? login : authMode === 'signup' ? signup : verifyTwoFactor} disabled={authMode === 'login' ? loginBusy : authMode === 'signup' ? signupBusy : twoFactorBusy}>
              {authMode === 'login'
                ? (loginBusy ? 'جارٍ التحقق...' : 'دخول إلى لوحة التحكم')
                : authMode === 'signup'
                  ? (signupBusy ? 'جارٍ إنشاء المكتب...' : 'إنشاء المكتب والدخول')
                  : (twoFactorBusy ? 'جارٍ التحقق...' : 'تأكيد الرمز')}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setLoginError('')
              setTwoFactorCode('')
              setTwoFactorUser(null)
              setForgotSent(false)
              setResetDone(false)
              setAuthMode(authMode === 'forgot' || authMode === 'reset' ? 'login' : authMode === 'login' ? 'signup' : 'login')
            }}
            style={{ marginTop: 10, background: 'none', border: 'none', color: '#D4AF37', fontFamily: "'Cairo', sans-serif", fontSize: '.8rem', fontWeight: 800, cursor: 'pointer', width: '100%' }}
          >
            {authMode === 'login' ? 'إنشاء مكتب جديد'
              : authMode === 'signup' ? 'لدي حساب بالفعل'
              : authMode === 'forgot' || authMode === 'reset' ? 'الرجوع لتسجيل الدخول'
              : 'الرجوع لتسجيل الدخول'}
          </button>
          <div className="lhint">
            دُسْتُورِي · {authMode === 'login' ? 'منظومة المحامي الذكي'
              : authMode === 'signup' ? 'كل تسجيل جديد ينشئ مكتباً مستقلاً'
              : authMode === 'forgot' ? 'سيصلك رابط عبر البريد الإلكتروني'
              : authMode === 'reset' ? 'الرابط صالح لمدة 30 دقيقة من طلبه'
              : 'جلسة التحقق صالحة لمدة 10 دقائق'}
          </div>
        </div>
      </div>
    </div>
  )
}
