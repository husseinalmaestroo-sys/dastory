'use client'

import { SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function MojPage() {
  const { openModal } = useDashboard()
  const onGuide = (service: string) => openModal('m-moj-guide', { service })

  const groups = [
    ['● خدمات الاستعلام', ['لوحة البيانات', 'الاستعلام عن القضايا', 'القضايا التنفيذية', 'خدمة إخلاء سبيل'], 'gold'],
    ['● الدعاوى والطلبات', ['الدعاوى المدنية', 'إضافة وكيل على الدعاوى', 'الطلبات الإجرائية', 'إيداع الأوراق القضائية'], 'blue'],
    ['● الطعون والتسجيل', ['تسجيل الإعتراض', 'تسجيل الاستئناف', 'تسجيل التمييز ولوائحه', 'خدمات كاتب العدل'], 'green'],
  ]
  return (
    <div className="pg">
      <SectionHeader title="بوابة وزارة العدل" subtitle="الخدمات الإلكترونية القضائية">
        <a href="https://services.moj.gov.jo" target="_blank" className="dbtn dbtn-s" style={{ textDecoration: 'none' }}>🔗 فتح البوابة</a>
      </SectionHeader>
      <div style={{ background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 11, padding: '12px 16px', marginBottom: 16, fontSize: '.82rem', color: '#F59E0B' }}>
        💡 هذه الخدمات تُفتح مباشرةً على بوابة وزارة العدل. يمكنك استخدام المساعد القانوني لمساعدتك في تعبئة النماذج.
      </div>
      <div className="g3">
        {groups.map(([label, services, tone]) => (
          <div key={String(label)} style={{ display: 'contents' }}>
            <div style={{ gridColumn: '1/-1', marginTop: 8 }}><div style={{ fontSize: '.68rem', fontWeight: 800, color: '#64748B', letterSpacing: '.08em', marginBottom: 8 }}>{label as string}</div></div>
            {(services as string[]).map((service) => (
              <button key={service} className="mjc" onClick={() => onGuide(service)}>
                <span className="mn">{service}</span>
                <span className="mai" style={{ background: tone === 'gold' ? 'rgba(212,175,55,.12)' : tone === 'blue' ? 'rgba(96,165,250,.12)' : 'rgba(52,211,153,.1)', color: tone === 'gold' ? 'var(--gold)' : tone === 'blue' ? '#60A5FA' : '#34D399' }}>+ مساعد</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
