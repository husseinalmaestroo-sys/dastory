# Real-corpus probes — LIVE

- Ran: 2026-10-06T16:32:15.981Z · commit a1e22b00cf3f · probe file sha256 c5eb0c0f238c8d68… (1 recorded change(s))
- Target: ep-noisy-base-asxes3nn.c-4.eu-central-1.aws.neon.tech:5432/neondb (Neon endpoint ep-noisy-base-asxes3nn) — BRANCH (DATABASE_ENVIRONMENT) · transport neon-websocket
- Corpus c-f0fdea7d0a58 · prompt p2-c5ad1854b44e · embedding openai/text-embedding-3-small (1536) · rerank none · no chat model (retrieval and pre-generation stops only)
- Preflight: PASS (provider probe included)

| Metric | Value |
|---|---|
| Probes passed | 30 / 32 |
| Law level (n=28): Recall@8 · MRR · Precision@8 | 92.9% · 0.929 · 78.6% |
| Named article (n=4): Hit@1 · MRR | 100.0% · 1.000 |
| Designed behaviour (modes) | 3 / 3 |
| Article integrity (whole or with provisos) | 14 / 14 |
| HARD: held-back chunks retrieved | 0 |
| HARD: class-order violations | 0 |

| Probe | Category | Expected | Outcome | Pass |
|---|---|---|---|---|
| p01 | exact_law_name | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p02 | exact_law_name | retrieve: the law is servable (161) | first source of it at rank 1 | ✓ |
| p03 | law_and_article | article_first: article 28 is in the servable text of the law | the named article ranks first | ✓ |
| p04 | law_and_article | article_first: article 5 is in the servable text of the law | the named article ranks first | ✓ |
| p05 | article_only | clarification: article 28 is in 17 servable texts (177, 193, 185, 166, 163, 161, 165, 174, 34, 167, 160, 176, …) | mode clarification | ✓ |
| p06 | arabic_indic_digits | article_first: article 28 is in the servable text of the law | the named article ranks first | ✓ |
| p07 | arabic_indic_digits | article_first: article 5 is in the servable text of the law | the named article ranks first | ✓ |
| p08 | morphology | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p09 | morphology | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p10 | provisos | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p11 | provisos | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p12 | definitions | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p13 | definitions | retrieve: the law is servable (159) | first source of it at rank 1 | ✓ |
| p14 | amended_articles | retrieve: the law is servable (170, 188) | no source of it in the top 8 (mode no_evidence) | ✗ |
| p15 | amended_articles | retrieve: the law is servable (175, 20, 182) | first source of it at rank 1 | ✓ |
| p16 | historical_version | retrieve: the law is servable (170, 188) | first source of it at rank 1 | ✓ |
| p17 | historical_version | retrieve: the law is servable (170, 188) | first source of it at rank 1 | ✓ |
| p18 | false_premise | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p19 | false_premise | retrieve: the law is servable (161) | first source of it at rank 1 | ✓ |
| p20 | unavailable_law | retrieve: the law is servable (172) | first source of it at rank 1 | ✓ |
| p21 | unavailable_law | retrieve: the law is servable (172) | first source of it at rank 1 | ✓ |
| p22 | cross_law_ambiguity | clarification: article 2 is in 39 servable texts (73, 227, 160, 159, 96, 165, 177, 167, 213, 230, 172, 27, …) | mode clarification | ✓ |
| p23 | cross_law_ambiguity | clarification / grounded / partial / sources_only / no_evidence: the designed behaviour (pre-registered) | mode clarification | ✓ |
| p24 | decision_query | retrieve: servable source(s) titled with "تفسير + 30": 105 | no source of it in the top 8 (mode generation) | ✗ |
| p25 | decision_query | retrieve: the law is servable (160) | first source of it at rank 1 | ✓ |
| p26 | regulation_query | retrieve: servable source(s) titled with "نظام + رسوم + الكاتب العدل": 201 | first source of it at rank 1 | ✓ |
| p27 | regulation_query | retrieve: servable source(s) titled with "الكاتب العدل": 9, 52, 60, 177, 198, 200, 201, 204, 208, 220 | first source of it at rank 1 | ✓ |
| p28 | class_ordering | class_order: legislation before lower classes (the hard check) | class order holds over 8 result(s) | ✓ |
| p29 | class_ordering | retrieve: servable source(s) titled with "مذكرة تفاهم": 229, 230, 231, 232, 233 | first source of it at rank 1 | ✓ |
| p30 | not_proven_law | retrieve: the law is servable (166) | first source of it at rank 1 | ✓ |
| p31 | not_proven_law | retrieve: the law is servable (164) | first source of it at rank 1 | ✓ |
| p32 | not_proven_law | retrieve: the law is servable (167) | first source of it at rank 1 | ✓ |
