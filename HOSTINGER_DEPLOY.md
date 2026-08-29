# نشر النظام على Hostinger — خادم VPS واحد، تطبيقان في Docker

هذا الدليل يغطّي نشر **Dostoori** و**ailegal_hussein** معاً على **Hostinger KVM VPS**
عبر Docker. (استضافة Hostinger المشتركة / Business لا تصلح: `ailegal_hussein` يشغّل
Chromium فعلياً لتصدير PDF، ونداءات الذكاء الاصطناعي تستغرق 15–60 ثانية، و`/api/chat`
يبثّ عبر SSE — والاستضافة المشتركة تقطع هذا كلّه.)

## البنية

```
                    ┌─────────────────── VPS (Ubuntu 22/24) ───────────────────┐
   app.<domain> ───►│ nginx ─► 127.0.0.1:3000  dostoori_app  ─┐                │
 legal.<domain> ───►│         ─► 127.0.0.1:4000  legal_app  ◄─┘ (dostoori_net) │
                    │                              │                            │
                    │  dostoori_db (MySQL 8, حاوية) │  Neon (Postgres+pgvector,  │
                    │                              │   سحابي — الفهرس جاهز)     │
                    └──────────────────────────────┴────────────────────────────┘
```

- `dostoori_app` ينادي `ailegal_hussein` داخلياً على `http://legal_app:3000` عبر شبكة
  Docker مشتركة `dostoori_net` — لا يمرّ عبر nginx ولا TLS.
- MySQL في حاوية على نفس الخادم. Postgres يبقى على **Neon** (الفهرس القانوني الكامل
  مُدخَل ومُختبَر هناك — لا حاجة لإعادة الإدخال).
- المتطلّب الموصى به: **KVM 4GB+**. الـ 2GB ضيّقة (بناءان لـ Next + MySQL)؛ سكربت
  الإعداد يضيف 2GB swap كشبكة أمان.

---

## 1. DNS

سجّلين من نوع A يشيران إلى عنوان الخادم، **قبل** تشغيل `setup-nginx.sh` (certbot يتحقّق
من الملكية عبر HTTP):

| السجل | القيمة |
|---|---|
| `app.<domain>` | IP الخادم |
| `legal.<domain>` | IP الخادم |

---

## 2. جلب الشيفرة

ريبو GitHub واحد، فرعان. `ailegal_hussein` مُتجاهَل في `.gitignore` الخاص بـ Dostoori
ويُستنسَخ منفصلاً داخله:

```bash
ssh root@YOUR_VPS_IP
cd /opt
git clone <repo> dostoori && cd dostoori          # الفرع: main
git clone <repo> ailegal_hussein
(cd ailegal_hussein && git checkout ailegal-hussein)
```

---

## 3. التمهيد (مرّة واحدة)

```bash
bash deploy/setup-vps.sh
```

يُثبّت Docker، ويُنشئ swap والجدار الناري وشبكة `dostoori_net`، ويولّد `dostoori/.env`
بقيم عشوائية لـ `JWT_SECRET` و`TWO_FACTOR_ENCRYPTION_KEY` و`MYSQL_PASSWORD` و
`MYSQL_ROOT_PASSWORD`.

---

## 4. تعبئة ملفّي `.env`

### `ailegal_hussein/.env`
`deploy/setup-vps.sh` داخل مجلد `ailegal_hussein` يولّد `IP_HASH_SALT` و
`LAWYER_SESSION_SECRET` و`ADMIN_PASSWORD`. أضِف يدوياً:

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | رابط Neon كاملاً مع `?sslmode=require` |
| `OPENAI_API_KEY` | `sk-...` |
| `INTERNAL_SERVICE_KEY` | سلسلة عشوائية — **يجب أن تساوي** `AI_LEGAL_SERVICE_KEY` أدناه. ولّدها بـ `openssl rand -hex 32` |

### `dostoori/.env`

| المتغير | القيمة |
|---|---|
| `AI_LEGAL_SERVICE_URL` | `http://legal_app:3000` |
| `AI_LEGAL_SERVICE_KEY` | نفس `INTERNAL_SERVICE_KEY` أعلاه |
| `APP_URL` | `https://app.<domain>` |
| `PLATFORM_ADMIN_EMAILS` | بريد مدير المنصة |
| `SMTP_*` | اختياري — بدونها إرسال البريد يرجع 503 بدل تعطّل صامت |

> `DATABASE_URL` في Dostoori لا يُضبَط يدوياً — `docker-compose.yml` يبنيه من `MYSQL_*`
> ويوجّهه إلى حاوية `db`.

---

## 5. النشر

الترتيب مهم — `ailegal_hussein` أولاً كي يكون `legal_app` جاهزاً قبل أن يفحص Dostoori
مسار الذكاء الاصطناعي:

```bash
cd /opt/dostoori/ailegal_hussein && bash deploy/deploy.sh   # يبني، يهاجر (Neon)، يشغّل على 127.0.0.1:4000
cd /opt/dostoori                  && bash deploy/deploy.sh   # يبني، prisma migrate deploy، يشغّل على 127.0.0.1:3000
bash deploy/setup-nginx.sh <domain>                          # nginx: ملف واحد، السجلّان، ثم certbot لكليهما
```

`dostoori/deploy/deploy.sh` يتحقّق من `GET /api/health` = 200 (قاعدة البيانات + التخزين
هما الفحصان الحاملان؛ البريد/الذكاء الاصطناعي غير المُعدّين حالة موثّقة غير "متدهورة").

---

## 6. أول حساب حقيقي

لا بيانات دخول افتراضية. أنشئ أول مكتب/مدير عبر صفحة التسجيل الذاتي:

```
POST /api/auth/signup   (أو زر "إنشاء حساب" في الواجهة)
```

**لا تُشغّل `prisma/seed.ts` على الإنتاج** — يمسح البيانات وينشئ حسابات بكلمات مرور
معروفة، ومرفوض تلقائياً عند `NODE_ENV=production` ما لم يُضبَط `ALLOW_DEV_SEED=true`.

---

## 7. الترحيلات (Migrations) المستقبلية

```bash
# محلياً، مع قاعدة تطوير:
npx prisma migrate dev --name وصف_قصير
# راجع ملف SQL الناتج، أضِفه لِـ git.

# على الإنتاج (يطبّق فقط ما لم يُطبَّق، بالترتيب، بلا تأكيد تفاعلي):
cd /opt/dostoori && docker compose run --rm app npx prisma migrate deploy
```

**خذ نسخة احتياطية قبل أي ترحيل** (القسم 8). لا تُشغّل `migrate dev` ولا `db push` على
الإنتاج أبداً.

`ailegal_hussein` يستخدم `db/schema.sql` عبر `npm run db:migrate` (idempotent)، ويُنفَّذ
تلقائياً ضمن `deploy/deploy.sh`.

---

## 8. النسخ الاحتياطي

راجع [BACKUP.md](BACKUP.md). التغيير الوحيد في نمط الحاويات: MySQL صار داخل حاوية، فنسخ
قاعدة البيانات:

```bash
cd /opt/dostoori
docker compose exec -T db mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" > backup.sql
```

`scripts/backup-files.sh` (لمجلد `storage/`) يعمل كما هو — المجلد مربوط bind mount من
المضيف. الجزء الذي يحتاج إعداداً يدوياً: التخزين خارج الخادم (rclone) وجدولة cron —
موثّقان في BACKUP.md. **خذ نسخة قبل كل `migrate deploy`.**

---

## 9. تحديث الشيفرة لاحقاً

```bash
cd /opt/dostoori/ailegal_hussein && git pull && bash deploy/deploy.sh
cd /opt/dostoori                  && git pull && bash deploy/deploy.sh
```

كلا السكربتين يعيدان البناء والتشغيل بأقل توقّف. `restart: unless-stopped` في الـ compose
يعيد رفع الحاويات بعد إعادة تشغيل الخادم.

---

## 10. ملاحظات

- **HTTPS**: الكوكيز الحساسة (الجلسة) تُعلَّم `Secure` تلقائياً حسب `x-forwarded-proto`
  الذي يمرّره nginx — لا تعطّل الـ redirect الذي يضيفه certbot.
- **Rate limiting يعمل في ذاكرة عملية واحدة** (`src/lib/api-security.ts`) — صحيح وكافٍ
  طالما التطبيق عملية Node واحدة (وهو كذلك هنا). التوسّع الأفقي لاحقاً يحتاج مخزناً
  مشتركاً (Redis).
- **مهلة nginx** مضبوطة على 300 ثانية و`proxy_buffering off` — ضروريان لنداءات LLM
  الطويلة ولبثّ SSE في `/api/chat`.
- **ailegal_hussein**: حُذفت خدمة `db` من `docker-compose.yml` الخاص به (Postgres على
  Neon)، و`deploy/setup-nginx.sh` الخاص به مُلغى — الـ nginx لكليهما من هنا.
- **صور Docker**: `next.config.ts` يستخدم `output: 'standalone'`، و`prisma/schema.prisma`
  يضيف `debian-openssl-3.0.x` لهدف Prisma، و`canvas` انتقلت إلى `devDependencies`
  (اختبارات فقط) — كلّها لتصغير صورة الإنتاج وتفادي بناء أصلي لا لزوم له.

---

## 11. متغيرات البيئة — Dostoori

| المتغير | مطلوب؟ | ملاحظات |
|---|---|---|
| `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` | مطلوب (Docker) | حاوية MySQL؛ `DATABASE_URL` يُبنى منها تلقائياً في الـ compose |
| `DATABASE_URL` | مطلوب (غير Docker فقط) | اتصال MySQL — لا يُضبَط في نشر Docker |
| `JWT_SECRET` | مطلوب | ≥32 حرفاً، ليس قيمة معروفة — التطبيق يرفض الإقلاع بدونه |
| `TWO_FACTOR_ENCRYPTION_KEY` | مطلوب | نفس الشروط — لتشفير أسرار 2FA |
| `AI_LEGAL_SERVICE_URL` | مطلوب للذكاء الاصطناعي | رابط ailegal_hussein؛ `http://legal_app:3000` في Docker. بدونه كل `/dashboard/ai/*` و`/dashboard/search/legal` ترجع 503 |
| `AI_LEGAL_SERVICE_KEY` | مطلوب للذكاء الاصطناعي | **يجب أن يساوي** `INTERNAL_SERVICE_KEY` في ailegal_hussein |
| `PLATFORM_ADMIN_EMAILS` | اختياري | افتراضياً `admin@dostoori.jo` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | اختياري | بدونها إرسال البريد يرجع 503 |
| `APP_URL` أو `NEXT_PUBLIC_APP_URL` | اختياري | لبناء روابط كاملة؛ بدونه يُستنتج من ترويسات الطلب |
| `BACKUP_ENCRYPTION_PASSPHRASE` / `BACKUP_RCLONE_REMOTE` | اختياري | لسكربتات النسخ الاحتياطي فقط، راجع BACKUP.md |
