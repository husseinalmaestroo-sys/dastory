'use client'

import { useRouter } from 'next/navigation'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function MojGuideModal({ mojService }: { mojService: string }) {
  const { closeModal } = useDashboard()
  const router = useRouter()
  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">🏛️ {mojService} — دليل الاستخدام <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div style={{ fontSize: '.84rem', color: '#CBD5E1', lineHeight: 1.8 }}>
        <div style={{ background: 'rgba(212,175,55,.07)', border: '1px solid rgba(212,175,55,.15)', borderRadius: 9, padding: 12, marginBottom: 14 }}>
          <b>الخطوات المطلوبة:</b>
          <ol style={{ marginTop: 8, paddingRight: 18, lineHeight: 2 }}>
            <li>سجّل الدخول على services.moj.gov.jo ببيانات نقابة المحامين.</li>
            <li>انتقل إلى قسم "{mojService}".</li>
            <li>أدخل رقم القضية أو الطلب.</li>
            <li>أرفق المستندات المطلوبة بصيغة PDF.</li>
            <li>أرسل الطلب واحتفظ برقم المتابعة.</li>
          </ol>
        </div>
        <div style={{ fontSize: '.78rem', color: '#94A3B8' }}>💡 يمكن للمساعد الذكي مساعدتك في تجهيز المستندات المطلوبة لهذه الخدمة.</div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <a href="https://services.moj.gov.jo" target="_blank" className="dbtn dbtn-p" style={{ textDecoration: 'none' }}>🔗 فتح البوابة</a>
          <button className="dbtn dbtn-s" onClick={() => { closeModal(); router.push('/dashboard/ai/assistant') }}>🤖 اسأل المساعد</button>
        </div>
      </div>
    </div>
  )
}
