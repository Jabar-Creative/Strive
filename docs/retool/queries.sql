-- Query dasbor Retool superadmin — `SA-04`.
--
-- Setiap blok diawali `-- panel: <nama>`. Test integrasi membaca berkas ini,
-- menjalankan SETIAP blok SEBAGAI role `strive_readonly`, dan gagal kalau ada
-- satu pun yang tidak bisa dijalankan role itu.
--
-- Itu yang membedakan berkas ini dari dokumentasi: query yang ditulis sambil
-- masuk sebagai superuser akan berjalan mulus saat dicoba, lalu gagal di
-- Retool — dan gagalnya di depan orang yang sedang menelusuri insiden.
--
-- Parameter Retool ditulis `{{ nama.value }}`. Test menggantinya dengan nilai
-- contoh sebelum menjalankan, jadi SINTAKSNYA tetap diperiksa sungguhan.

-- panel: transaksi
-- Satu transaksi dari order sampai entri ledger. Kolom `paid_without_ledger`
-- sengaja ikut di depan: itu tanda bahaya yang harus terlihat tanpa dicari.
SELECT paid_without_ledger,
       order_id,
       order_created_at,
       order_status,
       email,
       display_name,
       coins_ordered,
       amount_idr,
       pricing_version,
       payment_event_type,
       payment_signature_ok,
       ledger_entry_type,
       ledger_amount,
       ledger_balance_after,
       paid_at
FROM admin_transactions
WHERE ({{ cari.value }} = '' OR email ILIKE '%' || {{ cari.value }} || '%'
                             OR order_id::text = {{ cari.value }})
ORDER BY order_created_at DESC
LIMIT 200;

-- panel: uang-masuk-tanpa-koin
-- Order `paid` yang TIDAK punya entri ledger: uang masuk, koin tidak keluar.
-- Kalau panel ini pernah tidak kosong, itu bukan laporan — itu insiden.
SELECT order_id,
       order_created_at,
       email,
       amount_idr,
       coins_ordered,
       payment_event_type,
       payment_signature_ok
FROM admin_transactions
WHERE paid_without_ledger
ORDER BY order_created_at DESC;

-- panel: tanda-tangan-webhook-gagal
-- `signature_ok = false` berarti ada yang mengirim webhook palsu untuk order
-- ini (PA-6). Hal pertama yang dicari saat menelusuri koin yang muncul entah
-- dari mana.
SELECT order_id,
       payment_received_at,
       email,
       payment_event_type,
       amount_idr,
       payment_payload
FROM admin_transactions
WHERE payment_signature_ok IS FALSE
ORDER BY payment_received_at DESC;

-- panel: riwayat-harga
-- Versi harga yang dipakai order, bukan harga yang berlaku sekarang. Order
-- lama HARUS tetap menunjuk versinya sendiri (`SA-02`).
SELECT pricing_version,
       count(*)                       AS jumlah_order,
       sum(amount_idr)                AS total_idr,
       sum(coins_ordered)             AS total_koin,
       min(order_created_at)          AS pertama,
       max(order_created_at)          AS terakhir
FROM admin_transactions
WHERE order_status = 'paid'
GROUP BY pricing_version
ORDER BY pricing_version DESC;

-- panel: audit
-- Identitas pelaku ikut, bukan cuma uuid-nya. Audit yang isinya uuid saja
-- memaksa satu query tambahan per baris, dan itu cukup menyakitkan untuk
-- membuat orang berhenti membacanya.
SELECT created_at,
       actor_email,
       actor_role,
       action,
       subject_type,
       subject_id,
       before,
       after,
       ip
FROM admin_audit
WHERE created_at >= now() - ({{ hari.value }} || ' days')::interval
ORDER BY created_at DESC
LIMIT 500;

-- panel: audit-tanpa-pelaku
-- Baris audit tanpa `actor_id` berarti sesuatu berubah dan tidak ada yang
-- mengaku. Seharusnya nol; kalau tidak, itu yang pertama ditelusuri.
SELECT created_at, action, subject_type, subject_id, ip
FROM admin_audit
WHERE actor_id IS NULL
ORDER BY created_at DESC
LIMIT 100;
