'use client'

import { Badge, SectionHeader, SettingRow } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

function RestrictedNotice() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 12, color: '#64748B', textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: '3rem' }}>🔒</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#94A3B8' }}>صلاحية محدودة</div>
      <div style={{ fontSize: '.85rem', maxWidth: 320, lineHeight: 1.8 }}>النسخ الاحتياطي متاح لمدير المكتب فقط.</div>
    </div>
  )
}

export default function BackupPage() {
  const { isAdmin } = useDashboard()
  if (!isAdmin) return <RestrictedNotice />

  return (
    <div className="pg">
      <SectionHeader title="النسخ الاحتياطي" subtitle="هذه الميزة تحتاج ربط مزود تخزين وجدولة قبل استخدامها في الإنتاج">
        <button className="dbtn dbtn-s" disabled style={{ opacity: .65, cursor: 'not-allowed' }}>💾 غير مفعّل</button>
      </SectionHeader>
      <div className="g2">
        <div className="card">
          <div className="ct">⚙️ حالة الربط</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SettingRow title="النسخ التلقائي" sub="غير مربوط حالياً" right={<Badge type="pe">● قيد الإعداد</Badge>} />
            <SettingRow title="مزود التخزين" sub="لم يتم اختيار مزود بعد" right={<Badge type="ur">● مطلوب</Badge>} />
            <SettingRow title="سياسة الاحتفاظ" sub="تحتاج تحديد عدد الأيام قبل التفعيل" right={<Badge type="ur">● مطلوب</Badge>} />
            <SettingRow title="التشفير" sub="سيتم تأكيده عند اختيار مزود التخزين" right={<Badge type="pe">● قيد الإعداد</Badge>} />
          </div>
        </div>
        <div className="card">
          <div className="ct">📋 السجل</div>
          <div style={{ color: '#94A3B8', fontSize: '.84rem', lineHeight: 1.9 }}>
            لا توجد نسخ احتياطية منشأة من داخل النظام حتى الآن. عند ربط التخزين والجدولة سيظهر هنا وقت كل نسخة وحجمها ونتيجة التنفيذ.
          </div>
        </div>
      </div>
    </div>
  )
}
