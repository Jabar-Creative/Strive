#!/usr/bin/env node
// `pnpm seed` — data dev minimum supaya stack ini bisa DIPAKAI, bukan cuma
// berdiri. Item `F-13` (isu #69).
//
// ── Apa yang dibuat ──
//
//   1. Satu pengguna jangkar `superadmin` — HANYA untuk `pricing_config.created_by`
//   2. Satu `pricing_config` aktif, angkanya dari docs/PRD.md §6 (TERKUNCI)
//   3. Satu track lengkap: track -> 2 modul -> 6 lesson -> 12 kartu
//   4. Delapan `store_items` (PRD §7 E14: "8 item di-seed manual")
//
// ── Tiga aturan yang membuatnya aman dijalankan berkali-kali ──
//
// 1. **Tidak pernah UPDATE, tidak pernah DELETE.** Hanya `INSERT ... ON
//    CONFLICT DO NOTHING`. Itu yang membuat "data yang sudah disentuh pengguna
//    tidak pernah ditimpa" benar *secara konstruksi*, bukan karena hati-hati.
//    Konsekuensinya disengaja: judul lesson yang kamu ubah TIDAK dikembalikan
//    seeder. Kalau mau ulang dari nol, hapus barisnya sendiri.
//
// 2. **`pricing_config` hanya disemai kalau tabelnya KOSONG.** Bukan
//    `ON CONFLICT` pada `version`: menerbitkan versi baru tiap kali seed
//    dijalankan akan membuat "versi aktif" melompat-lompat, dan order lama
//    menunjuk versi yang bukan harganya (`SA-02`). Dev yang sudah menerbitkan
//    harga uji juga tidak ingin itu diam-diam ditimpa.
//
// 3. **UUID deterministik.** Jalan kedua menghasilkan id yang sama, jadi
//    dokumen dan test bisa merujuknya. Bukan `gen_random_uuid()`.
//
// ── Pengguna jangkar TIDAK bisa login, dan itu disengaja ──
//
// `pricing_config.created_by` NOT NULL, jadi harus ada satu baris `users`.
// Barisnya dibuat tanpa kredensial apa pun: repo ini PUBLIK, dan menyemai akun
// yang bisa login sama dengan menerbitkan kunci masuk ke setiap lingkungan yang
// pernah menjalankan perintah ini.
//
// Untuk mendapat superadmin yang bisa dipakai: daftar lewat aplikasi seperti
// biasa, lalu naikkan peranmu sendiri —
//
//   UPDATE users SET role = 'superadmin' WHERE email = 'kamu@contoh.test';
//
// ── Bukan ini ──
//
// `pnpm seed:content` (`F-11`, Dev B) mengimpor konten belajar dari CSV/JSON.
// Yang ini data dev untuk menjalankan aplikasi. Jangan tertukar.

import pg from 'pg';

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const DB_URL = process.env.DATABASE_URL ?? URL_DEV;

/** UUID deterministik: `F13` + nomor. Segmen terakhir WAJIB 12 heksadesimal. */
const id = (n) => `00000000-0000-4000-8000-f13${String(n).padStart(9, '0')}`;

const ANCHOR = id(1);
const TRACK = id(2);

/**
 * Harga dari `docs/PRD.md` §6 — **TERKUNCI 14 September 2026** (§5).
 *
 * Disalin dari PRD, bukan dari fixture test mana pun. Fixture di
 * `admin-pricing.integration.spec.ts` memakai angka lain (cache hit 1200, CV
 * 1500) karena ia hanya menguji MEKANISME penerbitan versi, bukan harganya.
 * Menyalin dari sana akan menyemai harga yang salah ke setiap lingkungan dev.
 */
const HARGA = {
  coin_price_idr: 25, // Q1: 1 koin = Rp 25
  lesson_reward_coins: 20, // §6.1 — 1 lesson = 20 koin
  scan_cost_coins: 2400, // §6.2 — Rp 60.000
  scan_cached_cost_coins: 240, // §6.2 — cache hit, Rp 6.000
  cv_cost_coins: 400, // §6.2 — ATS CV generate
  interview_cost_coins: 300, // §6.2 — Mastery wawancara
  statement_cost_coins: 500, // §6.2 — Mastery personal statement
  prompt_run_cost_coins: 20, // §6.2 — Prompt Lab run
  freeze_cost_coins: 200, // §6.2 + Q3 — kredit freeze
  packages: [
    // §6.3. `price_idr` BUKAN coins × coin_price_idr — paket besar sengaja
    // lebih murah per koin (Rp 25,0 / 22,7 / 20,8).
    { id: 'starter', name: 'Starter', coins: 1000, price_idr: 25000 },
    { id: 'reguler', name: 'Reguler', coins: 2200, price_idr: 50000 },
    { id: 'skripsi', name: 'Skripsi', coins: 4800, price_idr: 100000 },
  ],
};

/** PRD §7 E14 SR-1: item digital saja — pustaka prompt, template, aset desain. */
const STORE = [
  ['prompt-riset-literatur', 'Pustaka Prompt: Riset Literatur', 'prompt_library', 300],
  ['prompt-revisi-skripsi', 'Pustaka Prompt: Revisi Skripsi', 'prompt_library', 300],
  ['prompt-wawancara-kerja', 'Pustaka Prompt: Wawancara Kerja', 'prompt_library', 500],
  ['template-notion-skripsi', 'Template Notion: Pelacak Skripsi', 'workspace_template', 700],
  ['template-notion-magang', 'Template Notion: Pencarian Magang', 'workspace_template', 700],
  ['template-sheet-keuangan', 'Template Sheet: Keuangan Mahasiswa', 'workspace_template', 500],
  ['aset-slide-sidang', 'Aset Desain: Slide Sidang', 'design_asset', 1200],
  ['aset-cv-ats', 'Aset Desain: Template CV Ramah ATS', 'design_asset', 1500],
];

/** Satu track lengkap — cukup untuk menjalankan /hub, /tracks, dan POST /attempts. */
const MODUL = [
  {
    n: 10,
    title: 'Dasar Menulis Akademik',
    lessons: [
      {
        n: 100,
        title: 'Apa itu parafrase',
        kartu: [
          {
            n: 1000,
            kind: 'multiple_choice',
            prompt: 'Mana yang merupakan parafrase yang benar?',
            options: [
              ['a', 'Menyalin kalimat asli dan mengganti dua kata', false, 'Ini masih plagiarisme'],
              [
                'b',
                'Menulis ulang gagasan dengan kalimat sendiri dan tetap mengutip sumbernya',
                true,
                'Gagasan tetap milik penulis asli, jadi sumbernya tetap dikutip',
              ],
              [
                'c',
                'Menerjemahkan dari bahasa lain tanpa menyebut sumber',
                false,
                'Terjemahan tanpa atribusi tetap plagiarisme',
              ],
            ],
          },
          {
            n: 1001,
            kind: 'swipe_binary',
            prompt: 'Mengutip sumber membuat tulisan terlihat kurang orisinal.',
            options: [
              ['setuju', 'Setuju', false, 'Justru sebaliknya — kutipan menunjukkan kamu membaca'],
              [
                'tidak',
                'Tidak setuju',
                true,
                'Kutipan menunjukkan kedalaman bacaan, bukan kelemahan',
              ],
            ],
          },
        ],
      },
      {
        n: 101,
        title: 'Mengutip tanpa plagiat',
        kartu: [
          {
            n: 1002,
            kind: 'multiple_choice',
            prompt: 'Kapan kutipan langsung lebih baik daripada parafrase?',
            options: [
              [
                'a',
                'Saat kalimat aslinya sangat khas dan sulit ditulis ulang tanpa kehilangan makna',
                true,
                'Definisi teknis dan rumusan khas lebih aman dikutip apa adanya',
              ],
              ['b', 'Saat kamu kehabisan waktu', false, 'Kehabisan waktu bukan alasan metodologis'],
              [
                'c',
                'Selalu — kutipan langsung selalu lebih aman',
                false,
                'Tulisan yang isinya kutipan semua tidak menunjukkan pemahaman',
              ],
            ],
          },
          {
            n: 1003,
            kind: 'swipe_binary',
            prompt:
              'Daftar pustaka boleh memuat sumber yang tidak pernah dikutip di badan tulisan.',
            options: [
              [
                'setuju',
                'Setuju',
                false,
                'Daftar pustaka mencatat yang DIKUTIP, bukan yang dibaca',
              ],
              [
                'tidak',
                'Tidak setuju',
                true,
                'Sumber yang tidak dikutip masuk bibliografi, bukan daftar pustaka',
              ],
            ],
          },
        ],
      },
      {
        n: 102,
        title: 'Membaca laporan kemiripan',
        kartu: [
          {
            n: 1004,
            kind: 'multiple_choice',
            prompt: 'Skor kemiripan 25% berarti apa?',
            options: [
              [
                'a',
                'Pasti plagiarisme',
                false,
                'Angka saja tidak menentukan; yang menentukan adalah BAGIAN mana yang mirip',
              ],
              [
                'b',
                'Seperempat teks cocok dengan sumber lain — termasuk kutipan sah dan daftar pustaka',
                true,
                'Kutipan dan daftar pustaka ikut terhitung, jadi angkanya harus dibaca per bagian',
              ],
              [
                'c',
                'Aman, di bawah 30%',
                false,
                'Ambang angka tanpa membaca laporannya adalah cara paling umum lolos dari yang seharusnya tidak',
              ],
            ],
          },
          {
            n: 1005,
            kind: 'swipe_binary',
            prompt: 'Kemiripan 0% selalu berarti tulisan aman.',
            options: [
              ['setuju', 'Setuju', false, 'Bisa berarti sumbernya tidak ada di indeks vendor'],
              ['tidak', 'Tidak setuju', true, '0% juga muncul saat dokumennya gagal diekstrak'],
            ],
          },
        ],
      },
    ],
  },
  {
    n: 11,
    title: 'Menyiapkan Karier',
    lessons: [
      {
        n: 110,
        title: 'CV yang terbaca mesin',
        kartu: [
          {
            n: 1010,
            kind: 'multiple_choice',
            prompt: 'Kenapa CV dua kolom sering bermasalah di sistem ATS?',
            options: [
              ['a', 'Warnanya terlalu banyak', false, 'Warna bukan masalah utama parser'],
              [
                'b',
                'Parser membaca dari kiri ke kanan dan mencampur isi kedua kolom',
                true,
                'Urutan teks jadi kacau sebelum manusia sempat membacanya',
              ],
              ['c', 'Ukuran berkasnya terlalu besar', false, 'Ukuran jarang jadi penyebab'],
            ],
          },
          {
            n: 1011,
            kind: 'swipe_binary',
            prompt: 'Menaruh kata kunci tersembunyi berwarna putih meningkatkan skor ATS.',
            options: [
              ['setuju', 'Setuju', false, 'Terdeteksi, dan biasanya langsung didiskualifikasi'],
              [
                'tidak',
                'Tidak setuju',
                true,
                'Teks tersembunyi terbaca parser dan terbaca sebagai kecurangan',
              ],
            ],
          },
        ],
      },
      {
        n: 111,
        title: 'Menulis pengalaman dengan dampak',
        kartu: [
          {
            n: 1012,
            kind: 'multiple_choice',
            prompt: 'Mana poin pengalaman yang paling kuat?',
            options: [
              [
                'a',
                'Bertanggung jawab atas media sosial organisasi',
                false,
                'Menyebut tugas, bukan hasil',
              ],
              [
                'b',
                'Mengelola Instagram organisasi; pengikut naik 1.200 → 4.800 dalam 6 bulan',
                true,
                'Ada angka awal, angka akhir, dan rentang waktu',
              ],
              [
                'c',
                'Aktif di berbagai kegiatan kemahasiswaan',
                false,
                'Tidak bisa diverifikasi dan tidak bisa dibandingkan',
              ],
            ],
          },
          {
            n: 1013,
            kind: 'swipe_binary',
            prompt: 'Pengalaman organisasi tidak layak masuk CV kalau bukan pekerjaan berbayar.',
            options: [
              ['setuju', 'Setuju', false, 'Yang dinilai bukti kemampuan, bukan statusnya berbayar'],
              [
                'tidak',
                'Tidak setuju',
                true,
                'Pengalaman organisasi dengan hasil terukur setara pengalaman kerja',
              ],
            ],
          },
        ],
      },
      {
        n: 112,
        title: 'Menyusun prompt yang berguna',
        kartu: [
          {
            n: 1014,
            kind: 'multiple_choice',
            prompt: 'Bagian mana yang paling sering dilupakan saat menulis prompt?',
            options: [
              ['a', 'Peran', false, 'Biasanya justru ini yang pertama ditulis'],
              [
                'b',
                'Format keluaran yang diinginkan',
                true,
                'Tanpa format, jawabannya benar tapi tidak bisa langsung dipakai',
              ],
              ['c', 'Tugas', false, 'Tugas hampir selalu disebut'],
            ],
          },
          {
            n: 1015,
            kind: 'swipe_binary',
            prompt: 'Prompt yang lebih panjang selalu menghasilkan jawaban lebih baik.',
            options: [
              ['setuju', 'Setuju', false, 'Panjang tanpa struktur justru mengaburkan tugasnya'],
              [
                'tidak',
                'Tidak setuju',
                true,
                'Yang menentukan struktur dan kejelasan, bukan jumlah kata',
              ],
            ],
          },
        ],
      },
    ],
  },
];

async function main() {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const dibuat = { users: 0, pricing: 0, tracks: 0, modules: 0, lessons: 0, cards: 0, store: 0 };

  await c.query('BEGIN');
  try {
    // 1 · pengguna jangkar. Tanpa kredensial — lihat catatan di atas.
    const u = await c.query(
      `INSERT INTO users (id, email, display_name, role, timezone)
       VALUES ($1, 'seed-anchor@strive.local', 'Seed Anchor (tidak bisa login)', 'superadmin', 'Asia/Jakarta')
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [ANCHOR],
    );
    dibuat.users = u.rowCount;

    // 2 · harga. HANYA kalau tabelnya kosong — lihat aturan 2 di atas.
    const adaHarga = await c.query('SELECT 1 FROM pricing_config LIMIT 1');
    if (adaHarga.rowCount === 0) {
      await c.query(
        `INSERT INTO pricing_config
           (version, coin_price_idr, scan_cost_coins, scan_cached_cost_coins, lesson_reward_coins,
            cv_cost_coins, interview_cost_coins, statement_cost_coins, prompt_run_cost_coins,
            freeze_cost_coins, packages, created_by)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
        [
          HARGA.coin_price_idr,
          HARGA.scan_cost_coins,
          HARGA.scan_cached_cost_coins,
          HARGA.lesson_reward_coins,
          HARGA.cv_cost_coins,
          HARGA.interview_cost_coins,
          HARGA.statement_cost_coins,
          HARGA.prompt_run_cost_coins,
          HARGA.freeze_cost_coins,
          JSON.stringify(HARGA.packages),
          ANCHOR,
        ],
      );
      dibuat.pricing = 1;
    }

    // 3 · track lengkap.
    const t = await c.query(
      `INSERT INTO tracks (id, slug, title, description, category, is_published, sort_order)
       VALUES ($1, 'akademik-karier', 'Akademik & Karier',
               'Track contoh untuk pengembangan: menulis akademik yang jujur, lalu menyiapkan karier.',
               'akademik', true, 0)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [TRACK],
    );
    dibuat.tracks = t.rowCount;

    for (const [mi, m] of MODUL.entries()) {
      const r = await c.query(
        `INSERT INTO modules (id, track_id, title, sort_order)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id(m.n), TRACK, m.title, mi],
      );
      dibuat.modules += r.rowCount;

      for (const [li, l] of m.lessons.entries()) {
        const rl = await c.query(
          `INSERT INTO lessons (id, module_id, title, sort_order, base_coins, base_points)
           VALUES ($1, $2, $3, $4, $5, 10) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [id(l.n), id(m.n), l.title, li, HARGA.lesson_reward_coins],
        );
        dibuat.lessons += rl.rowCount;

        for (const [ki, k] of l.kartu.entries()) {
          const content = {
            options: k.options.map(([oid, text, correct, why]) => ({
              id: oid,
              text,
              correct,
              why,
            })),
          };
          const rk = await c.query(
            `INSERT INTO lesson_cards (id, lesson_id, kind, prompt, content, sort_order)
             VALUES ($1, $2, $3::card_kind, $4, $5::jsonb, $6)
             ON CONFLICT (id) DO NOTHING RETURNING id`,
            [id(k.n), id(l.n), k.kind, k.prompt, JSON.stringify(content), ki],
          );
          dibuat.cards += rk.rowCount;
        }
      }
    }

    // 4 · store.
    for (const [slug, title, kind, price] of STORE) {
      const r = await c.query(
        `INSERT INTO store_items (slug, title, kind, price_coins, asset_key)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [slug, title, kind, price, `store/${slug}.zip`],
      );
      dibuat.store += r.rowCount;
    }

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }

  const total = Object.values(dibuat).reduce((a, b) => a + b, 0);
  console.log(
    total === 0
      ? '[seed] sudah lengkap — tidak ada yang ditambahkan (idempoten).'
      : `[seed] ditambahkan: ${Object.entries(dibuat)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${n} ${k}`)
          .join(' · ')}`,
  );
  console.log(
    '[seed] Pengguna jangkar TIDAK bisa login. Untuk superadmin yang bisa dipakai:\n' +
      "        daftar lewat aplikasi, lalu: UPDATE users SET role='superadmin' WHERE email='…';",
  );
  await c.end();
}

await main();
