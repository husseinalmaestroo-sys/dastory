// The single source of truth for "what each role can do". Rendered on both
// /dashboard/settings and /dashboard/team so the two never drift — earlier
// the team page listed سكرتير / محاسب columns for roles that don't exist.
//
// The Role enum is OFFICE_MANAGER | LAWYER | CITIZEN. There is no secretary,
// accountant, or trainee role. If one is ever added, add its column here and
// both pages pick it up.

const ROWS: [string, string, string, string][] = [
  ['لوحة التحكم', '✓ كل بيانات المكتب', '✓ بياناته فقط', '✓ بوابة منفصلة'],
  ['إدارة العملاء', '✓ الكل', '✓ عملاؤه + من له قضية معهم', '—'],
  ['إدارة القضايا', '✓ الكل', '✓ قضاياه فقط', 'عرض قضاياه فقط'],
  ['الجلسات والفواتير', '✓ الكل', '✓ المرتبطة بقضاياه فقط', 'عرض فقط'],
  ['الملفات والمستندات', '✓ الكل', '✓ ملفاته وملفات قضاياه فقط', '—'],
  ['مراجعة العقود والمساعد بالذكاء الاصطناعي', '✓', '✓', '—'],
  ['إدارة الفريق', '✓', '—', '—'],
  ['التقارير الكاملة وسجل التدقيق', '✓', '—', '—'],
  ['النسخ الاحتياطي', 'الواجهة جاهزة، التفعيل يحتاج ربط مزود تخزين', '—', '—'],
]

export function PermissionsMatrix() {
  return (
    <div className="card">
      <div className="ct">🔐 مصفوفة الصلاحيات</div>
      <table className="pt">
        <tbody>
          <tr><th>الوحدة</th><th>مدير المكتب</th><th>محامٍ</th><th>الموكّل (بوابة العميل)</th></tr>
          {ROWS.map(([name, ...cells]) => (
            <tr key={name}>
              <td>{name}</td>
              {cells.map((cell, index) => (
                <td key={index}><span className={cell.startsWith('✓') ? 'pck' : 'pxm'}>{cell}</span></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: '.76rem', color: '#64748B', lineHeight: 1.8 }}>
        لا توجد أدوار &quot;سكرتير&quot; أو &quot;محاسب&quot; أو &quot;متدرب&quot; بالنظام حالياً — الأدوار المتاحة فعلياً هي مدير المكتب والمحامي والموكّل فقط، وهذه الصلاحيات مُطبَّقة على مستوى الخادم لا الواجهة فقط.
      </div>
    </div>
  )
}
