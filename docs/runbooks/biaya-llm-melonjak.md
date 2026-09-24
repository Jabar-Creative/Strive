# Runbook — biaya LLM melonjak

PRD §17.3 skenario 3.

**Gejala.** `alert: true` pada `llm_cost.spike` di
`GET /admin/integrations/health`, atau baris log `ambang metrik terlampaui:
llm_daily_cost`.

**Ambangnya rasio, bukan angka absolut** (keputusan Fatih, 23 Sep): 3× di atas rata-rata
enam hari sebelumnya, dengan lantai $0,50 supaya angka receh tidak berbunyi.

> **Yang TIDAK akan memicu alert, dan harus dicari dengan mata.** Kenaikan pelan —
> misalnya 10% sehari — tidak pernah mencapai 3× dari rata-rata bergeraknya. Sebulan
> kemudian tagihannya belasan kali lipat tanpa satu pun alarm. Yang memperlihatkannya
> `last_7_days` di endpoint yang sama. **Lihat tren itu setiap kali membuka dasbor**,
> bukan hanya saat ada alert.

## 1 · Lihat sebarannya dulu: satu pengguna, atau semua?

```sql
SELECT user_id, count(*) AS jobs, sum(cost_usd) AS usd
FROM ai_jobs
WHERE cost_usd IS NOT NULL
  AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date
GROUP BY user_id ORDER BY usd DESC LIMIT 20;
```

Ini pertanyaan yang menentukan seluruh langkah berikutnya:

- **Satu-dua pengguna mendominasi** → abuse atau bug di sisi mereka. Lanjut ke 2.
- **Rata di banyak pengguna** → pertumbuhan organik. Lompat ke 4.

Sekalian periksa modelnya — lonjakan sering berarti sesuatu diam-diam memakai model
yang lebih mahal:

```sql
SELECT model, count(*), sum(cost_usd) FROM ai_jobs
WHERE cost_usd IS NOT NULL AND created_at > now() - interval '24 hours'
GROUP BY model ORDER BY 3 DESC;
```

## 2 · Turunkan kuota harian lewat config

Kuota AI harian ada di `pricing_config` (PRD §6). Menerbitkan versi baru **tidak pernah
menimpa** versi lama (`SA-3`), jadi ini aman dan bisa dikembalikan.

```
PATCH /api/v1/admin/pricing    (superadmin)
```

## 3 · Kalau polanya abuse, suspend akunnya

```
PATCH /api/v1/admin/users/:id/role    (superadmin)
```

Setiap aksi tercatat di `audit_log` dengan `actor_id` (`SA-4`).

## 4 · Kalau memang organik, naikkan hard limit vendor

§12.3 mewajibkan **batas biaya dipasang di dashboard vendor sejak hari pertama**. Kalau
lonjakannya organik, yang dinaikkan batas itu — bukan dibiarkan tanpa batas.

**Jangan mematikan alert-nya.** Yang disetel ambangnya
(`AMBANG_LONJAKAN`/`LANTAI_LONJAKAN_USD` di
`apps/api/src/modules/admin/integrations-health.service.ts`), dan perubahannya masuk PR
supaya alasannya tercatat.

## 5 · Periksa job yang gagal berulang

Job yang gagal tetap **membakar biaya** kalau kegagalannya terjadi setelah LLM menjawab.
Tiga percobaan per job (`AI-06`) berarti satu job rusak bisa berbiaya tiga kali.

```sql
SELECT kind, count(*), sum(cost_usd) FROM ai_jobs
WHERE status = 'failed' AND created_at > now() - interval '24 hours'
GROUP BY kind;
```
