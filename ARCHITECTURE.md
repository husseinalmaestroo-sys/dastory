# دُسْتُورِي — Architecture Reference

> مرجع ثابت للبنية التقنية. لا خروج عن هذا القرار إلا بتحديث هذا الملف.

---

## نظرة عامة

```
                Next.js Frontend
                      │
        ┌─────────────┼─────────────┐
        │             │             │
 Authentication   REST API      WebSocket
        │             │             │
        └─────────────┼─────────────┘
                 NestJS Backend
        ┌─────────────┼──────────────┐
        │             │              │
   PostgreSQL      Redis        AI Service
        │             │              │
        │        Cache/Queue      OpenAI
        │                          RAG
        │                           │
   Document Storage         Vector Database
      (S3/MinIO)          (Qdrant/Pinecone)
```

---

## Frontend

### Stack المختار

| التقنية | الإصدار | السبب |
|---|---|---|
| Next.js | 15 | Server Components + SEO + سرعة |
| React | 19 | |
| TypeScript | latest | Type-safety |
| Tailwind CSS | latest | Styling سريع |
| shadcn/ui | latest | Components جاهزة للإنتاج |
| TanStack Query | latest | Server state management |
| React Hook Form | latest | Forms |
| Zod | latest | Validation |
| Framer Motion | latest | Animations |

### هيكل المجلدات

```
src/
  app/
    dashboard/
    chat/
    laws/
    documents/
    clients/
    cases/
    admin/
  components/
  lib/
  hooks/
  services/
  types/
```

كل صفحة مستقلة.

---

## Backend

### Stack المختار: NestJS (وليس Express)

**السبب:**
- منظم + Dependency Injection
- Guards + Validation + Swagger
- مناسب للمشاريع الكبيرة

### هيكل المجلدات

```
src/
  modules/
    auth/
    users/
    law/
    documents/
    chat/
    cases/
    clients/
    ai/
    analytics/
    notifications/
  common/
  config/
  database/
```

كل Module منفصل.

---

## API

### النهج: REST API (وليس GraphQL)

**السبب:** أسهل + أسرع + Swagger يولد التوثيق تلقائياً.

### Endpoints الأساسية

```
POST   /auth/login
POST   /auth/register

GET    /laws
GET    /laws/:id

POST   /documents/upload
POST   /documents/analyze

POST   /chat

GET    /cases
POST   /cases
PATCH  /cases/:id
DELETE /cases/:id
```

---

## Real-Time

```
WebSocket — Socket.io
```

يُستخدم لـ:
- AI Chat
- Notifications
- Live Collaboration

---

## Database

### الاختيار: PostgreSQL (وليس MongoDB)

البيانات القانونية علاقية بطبيعتها.

### الجداول

```
users              law_versions
roles              articles
permissions        court_decisions
clients            conversations
cases              messages
documents          embeddings
laws               subscriptions
                   payments
                   audit_logs
                   notifications
```

### ORM: Prisma (وليس TypeORM)

- أسرع بالتطوير
- Migration ممتازة
- Type-safe
- Developer Experience ممتازة

---

## AI Module

### التدفق الداخلي

```
AI Module
  ↓
Chat
  ↓
Prompt Builder
  ↓
RAG
  ↓
LLM
  ↓
Response Formatter
```

### تدفق RAG

```
User Question
  ↓
Embedding
  ↓
Vector Search
  ↓
Relevant Laws
  ↓
Prompt
  ↓
OpenAI
  ↓
Answer
  ↓
Citations
```

### Vector Database: Qdrant (وليس Pinecone)

- مفتوح المصدر
- أرخص
- سريع
- يمكن self-hosting

---

## Cache — Redis

```
Sessions
Rate Limiting
Caching
Queue
AI Responses
```

---

## Queue — BullMQ

لكل العمليات الثقيلة (لا تجعل المستخدم ينتظر):

```
Upload PDF
OCR
Embedding
AI Analysis
Email
Notifications
```

---

## File Storage

| البيئة | الخدمة |
|---|---|
| Development | MinIO |
| Production | Cloudflare R2 أو AWS S3 |

---

## Authentication & Security

- JWT + Refresh Token
- RBAC — الأدوار:

```
Admin
Lawyer
Researcher
Client
```

- Helmet
- CSRF Protection
- Rate Limiting
- SQL Injection Protection
- XSS Protection
- Input Validation
- Encrypted Storage
- Audit Logs

---

## البحث

```
PostgreSQL Full Text Search
+
Vector Search
```

النتيجة: دقة عالية جداً في البحث القانوني.

---

## Deployment

| الخدمة | الأداة |
|---|---|
| Frontend | Vercel |
| Backend | Docker + Coolify / Railway / DigitalOcean |
| PostgreSQL | Managed أو Docker |
| Redis | Managed أو Docker |
| Qdrant | Docker |
| MinIO | Docker |

كلها داخل **Docker Compose** في مرحلة التطوير.

---

---

## ربط بوابة وزارة العدل (services.moj.gov.jo)

### الوضع الحالي
وزارة العدل لا توفر Public API. البوابة واجهة مستخدم فقط — لا يوجد توثيق API رسمي مفتوح.

### المسارات الممكنة

#### المسار 1 — شراكة رسمية (الموصى به للإنتاج)
1. تقديم طلب رسمي لدائرة تقنية المعلومات / وزارة العدل
2. التفاوض على مذكرة تفاهم (MOU)
3. التسجيل كشريك تقني معتمد
4. الحصول على API credentials + sandbox بيئة اختبار
5. توقيع اتفاقية مستوى الخدمة (SLA)

**جهة التواصل:** وزارة العاقتصاد الرقمي والريادة + وزارة العدل (دائرة تقنية المعلومات)

#### المسار 2 — بوابة الحكومة الرقمية الأردنية
- منصة **Jordan Digital Government** تدعم بعض APIs الحكومية
- التواصل مع وحدة التحول الرقمي في رئاسة الوزراء
- URL: digital.gov.jo

#### المسار 3 — Browser Automation (للنماذج الأولية فقط)
```
Playwright / Puppeteer
↓
Login إلى services.moj.gov.jo ببيانات المحامي
↓
تعبئة النماذج تلقائياً من بيانات القضية في دُسْتُورِي
↓
إرجاع النتائج للمحامي
```
⚠️ هذا للنماذج الأولية والعروض التجريبية فقط — ليس للإنتاج.

### استراتيجية الإطلاق المقترحة

| المرحلة | الإجراء | الجدول |
|---|---|---|
| MVP | Browser Automation للعرض | شهر 1-3 |
| Beta | تقديم طلب الشراكة الرسمية | شهر 2 |
| v1.0 | API Integration الرسمي | شهر 6-12 |

---

> آخر تحديث: يونيو 2026
