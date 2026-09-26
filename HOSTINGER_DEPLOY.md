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
| `APP_URL` | `https://app.<domain>` — **مطلوب**؛ كل رابط يُرسَل بالبريد يُبنى منه وحده |
| `PLATFORM_ADMIN_EMAILS` | بريدك أنت — **مطلوب**، بلا قيمة افتراضية. الإدراج هنا لا يكفي وحده (القسم 6) |
| `BACKUP_ENCRYPTION_PASSPHRASE` | يولّده `setup-vps.sh` — **مطلوب** للنشر؛ انسخه خارج الخادم |
| `BACKUP_RCLONE_REMOTE` / `BACKUP_ALERT_WEBHOOK` | النسخ خارج الخادم وتنبيه الفشل — BACKUP.md |
| `SMTP_*` | اختياري — بدونها إرسال البريد يرجع 503 بدل تعطّل صامت، ولا يمكن تأكيد البريد |

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

`dostoori/deploy/deploy.sh` بالترتيب: فحص الإعدادات المطلوبة → بناء صورة موسومة بـ
commit (`dostoori-app:<sha>`) → **نسخة احتياطية مشفّرة قبل الترحيل (لا نسخة = لا نشر)** →
`prisma migrate deploy` من الصورة الجديدة والنسخة القديمة ما زالت تخدم → التبديل → انتظار
`healthy` من Docker **و** رقم الإصدار الجديد في `/api/health` → **رجوع تلقائي** للإصدار
السابق إن لم تصحّ → ثم **`scripts/smoke.sh`** على `127.0.0.1:3000`: تسجيل مكتب مؤقت → عميل/قضية/جلسة/فاتورة →
رفع مستند + توقيعه → (إن كان الذكاء الاصطناعي مُعدّاً) مراجعة عقد + محادثة بدورين.
أي فشل هنا يُفشل النشر (ارجع بـ `bash deploy/rollback.sh`). ميزات الذكاء الاصطناعي تتطلب
بريداً مؤكَّداً، والمكتب المؤقت غير مؤكَّد — لاختبارها أنشئ حساب smoke مرّة، أكّد بريده، ومرّره
بـ `SMOKE_EMAIL` / `SMOKE_PASSWORD`. لتشغيله على الرابط العام مباشرة:

```bash
SMOKE_URL="https://app.<domain>" SMOKE_REQUIRE_AI=1 bash scripts/smoke.sh https://app.<domain>
```

**اختبار حِمل مسار الذكاء الاصطناعي** (يكلّف مالاً — نداءات OpenAI حقيقية):

```bash
k6 run -e BASE=https://app.<domain> -e VUS=3 -e DURATION=5m scripts/load-ai.js
```

يُنجح إذا لم يظهر أي 502/504 وبقي p95 تحت 120 ثانية.

> `smoke.sh` و`load-ai.js` ينشئان مكاتب مؤقتة ببريد على نطاق `smoke.invalid` —
> تتراكم؛ احذفها دورياً بذلك النطاق.

---

## 5.1 بيئة staging (اختياري، موصى به)

`docker-compose.staging.yml` يشغّل نسخة موازية على نفس الـ VPS (أسماء ومنافذ وحجوم
منفصلة)، تخدمها nginx على `staging.<domain>`:

```bash
cp .env .env.staging   # عدّل MYSQL_* لأسرار خاصة بـ staging، و APP_URL=https://staging.<domain>
export APP_VERSION=$(git rev-parse --short=12 HEAD)   # صورة dostoori-app-staging:<sha>، منفصلة عن الإنتاج
docker compose -f docker-compose.staging.yml --env-file .env.staging build app
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d db
docker compose -f docker-compose.staging.yml --env-file .env.staging \
  run --rm app node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d app
bash scripts/smoke.sh https://staging.<domain>
```

انشُر إلى staging أولاً، شغّل `smoke.sh` عليها، وإن نجحت انشُر إلى الإنتاج.

---

## 6. أول حساب حقيقي، ومدير المنصة

لا بيانات دخول افتراضية. أنشئ أول مكتب/مدير عبر صفحة التسجيل الذاتي:

```
POST /api/auth/signup   (أو زر "إنشاء حساب" في الواجهة)
```

**مدير المنصة** (`/admin`) لا يُكتسَب بالتسجيل — حتى لو كان البريد في `PLATFORM_ADMIN_EMAILS`.
بعد التسجيل: أكّد البريد، فعّل المصادقة الثنائية من الإعدادات، ثم على الخادم:

```bash
cd /opt/dostoori
docker compose exec app node scripts/platform-admin.mjs grant you@<domain>
docker compose exec app node scripts/platform-admin.mjs list      # يبيّن ما ينقص إن وُجد
docker compose exec app node scripts/platform-admin.mjs revoke you@<domain>
```

الصلاحية تعمل فقط إذا اجتمعت كلها: المنح من الخادم + البريد في القائمة + بريد مؤكَّد + 2FA
مفعّلة ومُجتازة في الجلسة + دور مدير مكتب.

**لا تُشغّل `prisma/seed.ts` على الإنتاج** — يمسح البيانات وينشئ حسابات بكلمات مرور
معروفة، ومرفوض تلقائياً عند `NODE_ENV=production` ما لم يُضبَط `ALLOW_DEV_SEED=true`.

---

## 7. الترحيلات (Migrations) المستقبلية

```bash
# محلياً، مع قاعدة تطوير:
npx prisma migrate dev --name وصف_قصير
# راجع ملف SQL الناتج، أضِفه لِـ git.

# على الإنتاج: deploy.sh يطبّقها تلقائياً بعد نسخة احتياطية. يدوياً (نادراً):
cd /opt/dostoori && bash deploy/backup.sh db && \
  docker compose run --rm --no-deps app node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
```

لا تُشغّل `migrate dev` ولا `db push` على الإنتاج أبداً. الترحيلات للأمام فقط؛ اكتبها
**متوافقة مع الإصدار السابق** (إضافة أعمدة/جداول، لا حذف أو إعادة تسمية في نفس الإصدار)
كي يبقى الرجوع بـ `rollback.sh` آمناً.

**ترحيل فشل في منتصفه**: MySQL لا يلفّ DDL في معاملة، فقد يبقى جزء مطبّقاً. `deploy.sh`
يتوقف والإصدار القديم ما زال يخدم، ويطبع "restore point". الاسترجاع الدقيق:

```bash
docker compose stop app
set -a; . ./.env; set +a
BACKUP_DB_SERVICE=db RESTORE_DB_DROP_FIRST=1 bash scripts/restore-db.sh "$(cat .deploy/last_backup)"
docker compose start app
```

ثم أصلِح الترحيل وانشُر من جديد.

`ailegal_hussein` يستخدم `db/schema.sql` عبر `npm run db:migrate` (idempotent)، ويُنفَّذ
تلقائياً ضمن `deploy/deploy.sh`.

---

## 8. النسخ الاحتياطي

راجع [BACKUP.md](BACKUP.md). بعد أول نشر ناجح، مرّة واحدة:

```bash
apt-get install -y rclone && rclone config     # وجهة خارج الخادم (B2 / S3 / SFTP ...)
# في .env: BACKUP_RCLONE_REMOTE="<remote>:<bucket>/dostoori"  BACKUP_REQUIRE_OFFHOST="1"
#          BACKUP_ALERT_WEBHOOK="https://..."   (Slack/Discord/ntfy/healthchecks)
bash deploy/setup-backups.sh
```

يأخذ نسخة حقيقية (قاعدة البيانات + الملفات، مشفّرة، وتُنسَخ خارج الخادم ويُتحقَّق من
وصولها)، **ثم يسترجعها في قاعدة مؤقتة ويتحقق منها — ولا يثبّت cron إلا إن نجح ذلك**.
الجدولة: يومياً 03:17 UTC، واختبار استرجاع شهري. أي فشل يرسل تنبيهاً إلى
`BACKUP_ALERT_WEBHOOK`. كل شيء يعمل داخل حاوية `db` — لا يلزم عميل MySQL ولا Node على
المضيف.

---

## 9. تحديث الشيفرة لاحقاً

```bash
cd /opt/dostoori/ailegal_hussein && git pull && bash deploy/deploy.sh
cd /opt/dostoori                  && bash deploy/deploy.sh      # يسحب الشيفرة بنفسه (git pull --ff-only)
```

**الرجوع لإصدار سابق** (الشيفرة فقط؛ الترحيلات لا تُعكَس):

```bash
bash deploy/rollback.sh                 # الإصدار الذي قبل الحالي
docker images dostoori-app              # آخر 5 إصدارات محفوظة
bash deploy/rollback.sh <sha>           # أي إصدار محفوظ
cat .deploy/history                     # سجلّ النشر والرجوع
```

`restart: unless-stopped` في الـ compose يعيد رفع الحاويات بعد إعادة تشغيل الخادم.

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
- **تتبّع الأخطاء (Sentry)**: التطبيقان مربوطان بـ `@sentry/nextjs` (جهة الخادم فقط).
  بدون `SENTRY_DSN` الـ SDK خامل تماماً. عند ضبطه، الأخطاء غير المُعالَجة تُرسَل بعد
  تنقية البريد/الرموز/أجسام الطلبات (`src/lib/sentry-scrub.ts`). اضبط نفس المتغير
  في `.env` الخاص بكل تطبيق.
- **مراقبة التوفّر** (إعداد يدوي مطلوب): أضِف مراقباً خارجياً (BetterStack / UptimeRobot)
  على `https://app.<domain>/api/health` و`https://legal.<domain>/`، بفاصل دقيقتين وتنبيه
  SMS/Telegram. `/api/health` يرجع 503 إذا سقطت قاعدة البيانات أو التخزين أو غابت نماذج
  OCR، ويذكر رقم الإصدار. حاوية التطبيق لها `HEALTHCHECK` (`docker ps` يبيّن healthy).
- **ما يُراقَب وأين**: أخطاء التطبيق → Sentry (`SENTRY_DSN`)؛ التوفّر → المراقب الخارجي؛
  النسخ الاحتياطي واختبار الاسترجاع → `BACKUP_ALERT_WEBHOOK`؛ السجلات →
  `docker compose logs app`.
- **nginx** يرفض أي طلب بترويسة Host غير معروفة (444) ويضع `X-Real-IP` بنفسه؛ التطبيق يثق
  بها فقط لأن `TRUST_PROXY=1` في الـ compose.

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
| `APP_URL` | **مطلوب** | الأصل العام `https://app.<domain>`؛ التطبيق لا يقلع بدونه و`deploy.sh` يشترط https. كل روابط البريد منه — لا من ترويسة Host |
| `PLATFORM_ADMIN_EMAILS` | **مطلوب** | قائمة مسموحة بلا قيمة افتراضية؛ الصلاحية تحتاج أيضاً منحاً من الخادم (القسم 6) |
| `TRUST_PROXY` | في الـ compose | `1` خلف nginx — عناوين العملاء الحقيقية لحدود المعدّل وسجل التدقيق |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | اختياري | بدونها إرسال البريد يرجع 503 ولا يمكن تأكيد البريد |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | اختياري | تتبّع الأخطاء؛ بدونه الـ SDK خامل. اضبط نفس القيمة في `ailegal_hussein/.env` أيضاً |
| `BACKUP_ENCRYPTION_PASSPHRASE` | **مطلوب للنشر** | `deploy.sh` يأخذ نسخة مشفّرة قبل كل ترحيل ويرفض النشر بدونها |
| `BACKUP_RCLONE_REMOTE` / `BACKUP_REQUIRE_OFFHOST` / `BACKUP_ALERT_WEBHOOK` / `BACKUP_RETENTION_DAYS` / `BACKUP_REMOTE_RETENTION_DAYS` | موصى به | النسخ خارج الخادم، التنبيه، الاحتفاظ — BACKUP.md |
