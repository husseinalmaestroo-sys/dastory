# Critical laws and source classes — 2026-10-06T16:31:56.204Z

Target: ep-noisy-base-asxes3nn.c-4.eu-central-1.aws.neon.tech:5432/neondb (Neon endpoint ep-noisy-base-asxes3nn) — BRANCH (DATABASE_ENVIRONMENT)

| Check | Status | Evidence from this database |
|---|---|---|
| civil.id2 | INFO | id 2 is "القانون المدني الأردني رقم 43 لسنة 1976" — the Civil Code |
| civil.corrupted_not_servable | PASS | no corrupted Civil Code text is servable (2 source(s) of the law) |
| civil.replacement | INFO | servable Civil Code text(s): 172 (provenance not recorded, gazette unverified) |
| civil.amendments | INFO | no amending act of the Civil Code in this database |
| civil.named_question | PASS | named question: 0 chunk(s) of a held-back text; answered from a servable text |
| civil.own_words | PASS | searched by its own stored words: not reached |
| civil.by_id | PASS | client-supplied chunk ids: 0 returned |
| civil.citation | PASS | citation "القانون المدني رقم 43 لسنة 1976": 2 verified |
| penal.historical | PASS | "ما نص المادة 2 من قانون العقوبات رقم 16 لسنة 1960 كما كان قبل التعديل؟": no held-back Penal text reached |
| penal.historical | PASS | "ما عقوبة السرقة في قانون العقوبات القديم سنة 1960؟": no held-back Penal text reached |
| lob.159 | INFO | قانون التجارة رقم 12 لسنة 1966: provenance official (ديوان التشريع والرأي), integrity passed, gazette unverified |
| lob.160 | INFO | قانون العمل رقم 8 لسنة 1996: provenance official (ديوان التشريع والرأي), integrity passed, gazette unverified |
| lob.161 | INFO | قانون الشركات رقم 22 لسنة 1997: provenance official (ديوان التشريع والرأي), integrity passed, gazette unverified |
| labour.138 | INFO | article 138 is held by fewer than two sources: nothing to compare |
| labour.current_versions | PASS | 1 servable "current" Labour text(s): 160 |
| real_property | INFO | 165 "قانون الملكية العقارية رقم 13 لسنة 2019" number 13 year 2019 current true passed |
| not_proven.evidence | INFO | 166 "قانون البينات رقم 30 لسنة 1952" (matches the registry; ready/passed; servable true; number 30 year 1952) |
| not_proven.owners-tenants | INFO | 164 "قانون المالكين والمستأجرين رقم 11 لسنة 1994" (matches the registry; ready/passed; servable true; number 11 year 1994) |
| not_proven.income-tax | INFO | 167 "قانون ضريبة الدخل رقم 34 لسنة 2014" (matches the registry; ready/passed; servable true; number 34 year 2014) |
| classes.misfiled | PASS | every source type agrees with its title |
| classes.fee_schedules | PASS | 0 non-pleading "لائحة" filed as template |
| classes.executive_decisions | PASS | 0 executive decision(s) filed as court decisions |
| classes.jba_provenance | PASS | 0 Bar Association republication(s) without secondary provenance |
