/**
 * The field schema behind the drafting form — shared by the client (which
 * renders the inputs) and the server (which turns the filled values back into
 * labelled instructions for the model).
 *
 * The point of this file is that a lawyer should never have to type the parts
 * of a filing that never change. "محكمة بداية ... الموقرة", "المدعي:",
 * "لهذا يلتمس المدعي" are fixed furniture of the document; only the values are
 * the lawyer's. So the form asks for values, and the boilerplate is the
 * template's job.
 *
 * Deliberately NOT server-only: DraftAssistant imports it.
 */

export type DraftKind = "statement_of_claim" | "reply" | "defense_memo" | "petition" | "contract";

export type FieldType = "text" | "textarea" | "date";

export interface DraftField {
  id: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  /** Required fields gate the submit button — everything else may be left to
   *  the model to mark as [يُستكمل: ...]. */
  required?: boolean;
  /** Soft, non-blocking nudge shown near submit when empty — unlike
   *  `required`, this never disables the button. Only `contract` uses it
   *  today (duration/consideration/obligations), but the flag is generic. */
  recommended?: boolean;
  hint?: string;
  /** Grid columns to occupy on wide screens. */
  span?: 1 | 2;
  rows?: number;
}

export interface FieldGroup {
  title: string;
  fields: DraftField[];
}

export interface DraftForm {
  id: DraftKind;
  /** Tab label. */
  label: string;
  /** The heading printed on the document itself. */
  docTitle: string;
  groups: FieldGroup[];
}

const AGENT: DraftField = {
  id: "plaintiff_agent",
  label: "وكيله المحامي",
  type: "text",
  placeholder: "المحامي فلان الفلاني",
};

export const FORMS: DraftForm[] = [
  {
    id: "statement_of_claim",
    label: "لائحة دعوى",
    docTitle: "لائحة دعوى",
    groups: [
      {
        title: "المحكمة",
        fields: [
          {
            id: "court",
            label: "المحكمة",
            type: "text",
            placeholder: "بداية عمان",
            required: true,
            hint: "اكتب اسم المحكمة فقط — تُضاف كلمة «الموقرة» تلقائياً",
          },
          { id: "case_number", label: "رقم الدعوى (إن وُجد)", type: "text", placeholder: "1234/2026" },
          { id: "case_value", label: "قيمة الدعوى", type: "text", placeholder: "15,000 دينار أردني" },
        ],
      },
      {
        title: "المدعي",
        fields: [
          { id: "plaintiff_name", label: "اسم المدعي", type: "text", placeholder: "الاسم الرباعي", required: true },
          { id: "plaintiff_id", label: "الرقم الوطني / السجل التجاري", type: "text" },
          { id: "plaintiff_address", label: "عنوانه", type: "text", placeholder: "عمان — ..." },
          AGENT,
        ],
      },
      {
        title: "المدعى عليه",
        fields: [
          { id: "defendant_name", label: "اسم المدعى عليه", type: "text", required: true },
          { id: "defendant_id", label: "الرقم الوطني / السجل التجاري", type: "text" },
          { id: "defendant_address", label: "عنوانه", type: "text", span: 2 },
        ],
      },
      {
        title: "موضوع الدعوى ووقائعها",
        fields: [
          {
            id: "subject",
            label: "موضوع الدعوى",
            type: "text",
            placeholder: "مطالبة بمبلغ من المال",
            required: true,
            span: 2,
          },
          {
            id: "facts",
            label: "الوقائع",
            type: "textarea",
            required: true,
            rows: 6,
            span: 2,
            hint: "اكتبها كما جرت — سطر لكل واقعة. الترقيم والصياغة القانونية تتم تلقائياً.",
            placeholder:
              "أقرض المدعي المدعى عليه 15,000 دينار بتاريخ 2024/3/10\nوعد بالسداد خلال ستة أشهر\nطالبه المدعي مراراً وامتنع",
          },
          {
            id: "evidence",
            label: "البينات",
            type: "textarea",
            rows: 3,
            span: 2,
            placeholder: "سند الدين\nالشهود\nكشف حساب بنكي",
          },
          {
            id: "reliefs",
            label: "الطلبات",
            type: "textarea",
            required: true,
            rows: 4,
            span: 2,
            placeholder: "إلزام المدعى عليه بالمبلغ\nالفائدة القانونية\nالرسوم والمصاريف وأتعاب المحاماة",
          },
        ],
      },
    ],
  },

  {
    id: "reply",
    label: "لائحة جوابية",
    docTitle: "لائحة جوابية",
    groups: [
      {
        title: "الدعوى المردود عليها",
        fields: [
          { id: "court", label: "المحكمة", type: "text", placeholder: "بداية عمان", required: true },
          { id: "case_number", label: "رقم الدعوى", type: "text", placeholder: "1234/2026", required: true },
          {
            id: "subject",
            label: "موضوع الدعوى",
            type: "text",
            placeholder: "مطالبة بمبلغ من المال",
            required: true,
            span: 2,
          },
        ],
      },
      {
        title: "الأطراف",
        fields: [
          { id: "plaintiff_name", label: "المدعي", type: "text", required: true },
          { id: "defendant_name", label: "المدعى عليه (المجيب)", type: "text", required: true },
          { id: "plaintiff_agent", label: "وكيل المجيب المحامي", type: "text", span: 2 },
        ],
      },
      {
        title: "الرد",
        fields: [
          {
            id: "plaintiff_claims_summary",
            label: "ملخص ادعاءات المدعي",
            type: "textarea",
            required: true,
            rows: 4,
            span: 2,
            hint: "دوّن ما يدّعيه المدعي، بنداً بنداً إن أمكن — يُصاغ الرد على أساس ربطه بها تحديداً.",
            placeholder: "يدّعي المدعي أن المجيب مدين له بمبلغ 10,000 دينار بموجب سند دين مؤرخ...",
          },
          {
            id: "formal_defenses",
            label: "الدفوع الشكلية",
            type: "textarea",
            rows: 3,
            span: 2,
            hint: "اتركها فارغة إن لم يكن لديك دفوع شكلية",
            placeholder: "عدم الاختصاص المكاني\nمرور الزمن\nانعدام الصفة",
          },
          {
            id: "reply_to_facts",
            label: "الرد على الوقائع",
            type: "textarea",
            required: true,
            rows: 5,
            span: 2,
            placeholder: "أنكر البند 1 من اللائحة لأن...\nصحيح البند 2 لكن...",
          },
          {
            id: "substantive_defenses",
            label: "الدفوع الموضوعية",
            type: "textarea",
            rows: 4,
            span: 2,
            placeholder: "المبلغ مسدّد بموجب وصل\nالعقد باطل لانعدام المحل",
          },
          { id: "evidence", label: "البينات", type: "textarea", rows: 3, span: 2 },
          {
            id: "reliefs",
            label: "الطلبات",
            type: "textarea",
            required: true,
            rows: 3,
            span: 2,
            placeholder: "رد الدعوى\nتضمين المدعي الرسوم والمصاريف وأتعاب المحاماة",
          },
        ],
      },
    ],
  },

  {
    id: "defense_memo",
    label: "مذكرة دفاع",
    docTitle: "مذكرة دفاع",
    groups: [
      {
        title: "الدعوى",
        fields: [
          { id: "court", label: "المحكمة", type: "text", placeholder: "بداية عمان", required: true },
          { id: "case_number", label: "رقم الدعوى", type: "text", placeholder: "1234/2026", required: true },
          {
            id: "case_subject",
            label: "التهمة أو موضوع القضية",
            type: "text",
            placeholder: "سرقة / إخلال بالثقة / مطالبة مالية",
            required: true,
            span: 2,
          },
        ],
      },
      {
        title: "مقدّم المذكرة",
        fields: [
          { id: "party_name", label: "الاسم", type: "text", required: true },
          {
            id: "party_capacity",
            label: "الصفة",
            type: "text",
            placeholder: "المدعى عليه / المدعي",
            required: true,
          },
          { id: "plaintiff_agent", label: "وكيله المحامي", type: "text" },
          { id: "opposing_party", label: "الطرف الآخر", type: "text" },
        ],
      },
      {
        title: "المضمون",
        fields: [
          { id: "facts", label: "خلاصة الوقائع", type: "textarea", rows: 4, span: 2 },
          {
            id: "defense_points",
            label: "نقاط الدفاع",
            type: "textarea",
            required: true,
            rows: 6,
            span: 2,
            hint: "نقطة في كل سطر — تُبسط وتُسند قانونياً تلقائياً",
          },
          { id: "evidence", label: "البينات", type: "textarea", rows: 3, span: 2 },
          { id: "reliefs", label: "الطلبات", type: "textarea", required: true, rows: 3, span: 2 },
        ],
      },
    ],
  },

  {
    id: "petition",
    label: "طلب قانوني",
    docTitle: "طلب",
    groups: [
      {
        title: "الجهة",
        fields: [
          {
            id: "court",
            label: "الجهة / المحكمة",
            type: "text",
            placeholder: "بداية عمان",
            required: true,
          },
          { id: "case_number", label: "رقم الدعوى (إن وُجد)", type: "text", placeholder: "1234/2026" },
        ],
      },
      {
        title: "الأطراف",
        fields: [
          { id: "petitioner_name", label: "مقدّم الطلب", type: "text", required: true },
          {
            id: "petitioner_capacity",
            label: "صفة مقدّم الطلب",
            type: "text",
            placeholder: "المدعي / المدعى عليه / الغير",
            required: true,
          },
          { id: "plaintiff_agent", label: "وكيله المحامي", type: "text" },
          { id: "respondent_name", label: "المطلوب ضده", type: "text", span: 2 },
        ],
      },
      {
        title: "الطلب",
        fields: [
          {
            id: "petition_type",
            label: "نوع الطلب",
            type: "text",
            placeholder: "حجز تحفظي / تأجيل / إدخال شخص ثالث",
            required: true,
            span: 2,
          },
          {
            id: "grounds",
            label: "أسباب الطلب وسنده",
            type: "textarea",
            required: true,
            rows: 5,
            span: 2,
          },
          { id: "reliefs", label: "المطلوب", type: "textarea", required: true, rows: 3, span: 2 },
        ],
      },
    ],
  },

  {
    id: "contract",
    label: "عقد",
    docTitle: "عقد",
    groups: [
      {
        title: "العقد",
        fields: [
          { id: "contract_type", label: "نوع العقد", type: "text", placeholder: "إيجار / بيع / مقاولة", required: true },
          { id: "contract_place", label: "مكان الإبرام", type: "text", placeholder: "عمان" },
          { id: "contract_date", label: "تاريخ الإبرام", type: "date" },
          { id: "jurisdiction", label: "المحكمة المختصة", type: "text", placeholder: "محاكم عمان" },
        ],
      },
      {
        title: "الفريق الأول",
        fields: [
          { id: "party_one_name", label: "الاسم", type: "text", required: true },
          { id: "party_one_id", label: "الرقم الوطني / السجل التجاري", type: "text" },
          { id: "party_one_address", label: "العنوان", type: "text" },
          { id: "party_one_capacity", label: "الصفة", type: "text", placeholder: "المؤجر / البائع" },
          {
            id: "party_one_representative",
            label: "الممثل القانوني",
            type: "text",
            hint: "يُملأ إن كان الفريق شخصاً اعتبارياً (شركة/مؤسسة) يمثله شخص طبيعي في التوقيع",
          },
        ],
      },
      {
        title: "الفريق الثاني",
        fields: [
          { id: "party_two_name", label: "الاسم", type: "text", required: true },
          { id: "party_two_id", label: "الرقم الوطني / السجل التجاري", type: "text" },
          { id: "party_two_address", label: "العنوان", type: "text" },
          { id: "party_two_capacity", label: "الصفة", type: "text", placeholder: "المستأجر / المشتري" },
          {
            id: "party_two_representative",
            label: "الممثل القانوني",
            type: "text",
            hint: "يُملأ إن كان الفريق شخصاً اعتبارياً (شركة/مؤسسة) يمثله شخص طبيعي في التوقيع",
          },
        ],
      },
      {
        title: "محل العقد والالتزامات",
        fields: [
          { id: "subject", label: "محل العقد", type: "textarea", required: true, rows: 3, span: 2 },
          {
            id: "obligations_rights",
            label: "الالتزامات والحقوق",
            type: "textarea",
            rows: 4,
            span: 2,
            recommended: true,
            hint: "التزام كل فريق تجاه الآخر، بنداً لكل فريق",
          },
          {
            id: "consideration",
            label: "البدل وطريقة الدفع",
            type: "text",
            span: 2,
            recommended: true,
          },
          {
            id: "duration",
            label: "المدة",
            type: "text",
            placeholder: "سنة تبدأ من 2026/1/1",
            recommended: true,
          },
          { id: "termination", label: "أحكام الإنهاء", type: "text" },
        ],
      },
      {
        title: "بنود قانونية إضافية",
        fields: [
          {
            id: "confidentiality",
            label: "السرية",
            type: "textarea",
            rows: 2,
            span: 2,
            hint: "شرط حفظ سرية المعلومات المتبادلة، إن رغب الطرفان — يُحذف من المسودة تلقائياً إن تُرك فارغاً",
          },
          {
            id: "ip_terms",
            label: "الملكية الفكرية",
            type: "textarea",
            rows: 2,
            span: 2,
            hint: "ملكية أي نتاج فكري ينشأ عن تنفيذ العقد — يُملأ عند الحاجة فقط (خدمات/مقاولة/تطوير)، ويُحذف تلقائياً إن تُرك فارغاً",
          },
          {
            id: "breach_terms",
            label: "الإخلال بالعقد",
            type: "textarea",
            rows: 3,
            span: 2,
            hint: "الآثار المترتبة على إخلال أي فريق بالتزاماته وسبل المعالجة",
          },
          {
            id: "penalty_clause",
            label: "الشرط الجزائي",
            type: "textarea",
            rows: 2,
            span: 2,
            hint: "غرامة أو تعويض متفق عليه مسبقاً عند الإخلال، إن وُجد — يُحذف تلقائياً إن تُرك فارغاً",
          },
          { id: "force_majeure", label: "القوة القاهرة", type: "textarea", rows: 2, span: 2 },
          {
            id: "dispute_resolution",
            label: "آلية تسوية النزاعات",
            type: "text",
            placeholder: "التقاضي أمام المحاكم المختصة / التحكيم",
          },
          { id: "governing_law", label: "القانون الواجب التطبيق", type: "text", placeholder: "القانون الأردني" },
          {
            id: "special_terms",
            label: "شروط خاصة أخرى",
            type: "textarea",
            rows: 4,
            span: 2,
            hint: "شرط في كل سطر",
          },
        ],
      },
    ],
  },
];

export function getForm(kind: DraftKind): DraftForm {
  const form = FORMS.find((f) => f.id === kind);
  if (!form) throw new Error(`Unknown draft kind: ${kind}`);
  return form;
}

/** Every field id a given kind accepts, for validating what the client posts. */
export function fieldsOf(kind: DraftKind): DraftField[] {
  return getForm(kind).groups.flatMap((g) => g.fields);
}

/**
 * Flattens filled values into the labelled block the prompt shows the model.
 * Empty values are dropped rather than sent as blanks — a labelled empty
 * string reads to the model like "this is known to be nothing", while an
 * absent label leaves it free to mark the gap as [يُستكمل: ...].
 */
export function formatFields(kind: DraftKind, values: Record<string, string>): string {
  const lines: string[] = [];

  for (const group of getForm(kind).groups) {
    const filled = group.fields.filter((f) => values[f.id]?.trim());
    if (filled.length === 0) continue;

    lines.push(`## ${group.title}`);
    for (const f of filled) {
      const v = values[f.id].trim();
      lines.push(v.includes("\n") ? `${f.label}:\n${v}` : `${f.label}: ${v}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * A lawyer may skip the structured boxes entirely and describe the whole
 * matter in "ملاحظات إضافية" instead — the required-field gate (route.ts and
 * DraftAssistant.tsx) has to let that through rather than blocking on empty
 * boxes the lawyer never intended to fill. 40 chars is enough to exclude a
 * stray "شوف الملف" without excluding a real one-sentence fact pattern.
 */
export const FREE_TEXT_MIN_CHARS = 40;

export function hasSubstantialNotes(notes: string): boolean {
  return notes.trim().length >= FREE_TEXT_MIN_CHARS;
}

/** Filename stem for the downloaded file — kind + the party it concerns. */
export function draftFilename(kind: DraftKind, values: Record<string, string>): string {
  const form = getForm(kind);
  const who =
    values.plaintiff_name || values.party_name || values.petitioner_name || values.party_one_name || "";
  const stem = [form.docTitle, who.trim()].filter(Boolean).join(" - ");
  // Windows and most download paths reject these outright.
  return stem.replace(/[\\/:*?"<>|]/g, "").slice(0, 80) || form.docTitle;
}
