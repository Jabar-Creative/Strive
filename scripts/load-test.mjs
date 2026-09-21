#!/usr/bin/env node
// Load test `/hub` & leaderboard — `R-02`.
//
// Nol dependensi baru: `fetch` global Node 22 dan `pg` yang sudah dipakai
// `db-migrate.mjs`. Lintas-OS, `spawn` tidak dipakai sama sekali.
//
// ── Satu keputusan yang menentukan apakah angkanya berarti ──
//
// Beban dikirim **OPEN-LOOP**: permintaan berangkat pada jadwal tetap
// (500/detik), apa pun yang terjadi pada permintaan sebelumnya.
//
// Yang lazim ditulis orang adalah closed-loop: N pekerja, tiap pekerja
// menunggu responsnya sebelum mengirim lagi. Itu mengukur hal yang BERBEDA,
// dan kesalahannya searah — saat server melambat, closed-loop otomatis
// mengurangi laju kirimnya. Beban berkurang tepat ketika server sedang
// kesulitan, dan p95 yang dilaporkan terlihat bagus **karena permintaan yang
// akan lambat tidak pernah dikirim**. Namanya coordinated omission.
//
// Open-loop tidak punya rem itu. Kalau server tidak sanggup 500 rps, antreannya
// menumpuk dan latensi melonjak — persis yang akan dialami pengguna sungguhan,
// yang juga tidak berhenti membuka aplikasi hanya karena server sedang lambat.
//
// Konsekuensinya angkanya bisa jelek. Itu gunanya.
//
// ── Pemakaian ──
//
//   node scripts/load-test.mjs seed  --users 500
//   node scripts/load-test.mjs run   --rps 500 --duration 20 --out docs/reports/R-02
//
// `seed` menulis baris `sessions` LANGSUNG dengan token yang bisa ditebak.
// Itu disengaja: yang diukur `/hub`, bukan Argon2id. Melewati jalur
// registrasi sungguhan menghemat ~50 ms hashing per pengguna dan tidak
// mengubah apa pun yang diukur — `SessionGuard` hanya mencocokkan
// `sessions.token`.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const URL_DEV = 'postgres://strive:strive_dev_only@localhost:55432/strive';
const DB_URL = process.env.DATABASE_URL ?? URL_DEV;
const API = process.env.API_URL ?? 'http://localhost:3001';

/** Token deterministik — `seed` dan `run` tidak perlu bertukar berkas. */
const token = (i) => `load-test-token-${String(i).padStart(6, '0')}`;
/** UUID v4 sintetis: segmen terakhir WAJIB tepat 12 heksadesimal. */
const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function arg(nama, bawaan) {
  const i = process.argv.indexOf(`--${nama}`);
  return i === -1 ? bawaan : process.argv[i + 1];
}

// ── seed ───────────────────────────────────────────────────────────────────

async function seed(jumlah) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  console.log(`[load-test] menyemai ${jumlah} pengguna + sesi + squad…`);

  const SEASON = '00000000-0000-4000-8000-00000000lt01'.replace('lt', 'ff');
  const SQUAD = '00000000-0000-4000-8000-00000000lt02'.replace('lt', 'ff');
  const TRACK = '00000000-0000-4000-8000-00000000lt03'.replace('lt', 'ff');
  const MODUL = '00000000-0000-4000-8000-00000000lt04'.replace('lt', 'ff');

  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM users WHERE email LIKE 'load-test-%@uji.test'`);
    await client.query(
      `INSERT INTO league_seasons (id, code, starts_at, ends_at)
       VALUES ($1, 'LOAD-TEST', now(), now() + interval '7 days')
       ON CONFLICT (id) DO NOTHING`,
      [SEASON],
    );
    // Kapasitas squad dijaga trigger (migrasi 002) dengan batas max_members,
    // dan `squads_max_members_range` membatasi nilainya 8..12. Jadi pengguna
    // dibagi ke banyak squad, bukan ditumpuk di satu.
    const perSquad = 8;
    const nSquad = Math.ceil(jumlah / perSquad);
    for (let s = 0; s < nSquad; s++) {
      await client.query(
        `INSERT INTO squads (id, name, season_id, max_members)
         VALUES ($1, $2, $3, 8) ON CONFLICT (id) DO NOTHING`,
        [uuid(s + 100000), `LT-${s}`, SEASON],
      );
    }

    await client.query(
      `INSERT INTO tracks (id, slug, title) VALUES ($1, 'load-test', 'Load Test')
       ON CONFLICT (id) DO NOTHING`,
      [TRACK],
    );
    await client.query(
      `INSERT INTO modules (id, track_id, title) VALUES ($1, $2, 'M') ON CONFLICT (id) DO NOTHING`,
      [MODUL, TRACK],
    );
    for (let i = 0; i < 12; i++) {
      await client.query(
        `INSERT INTO lessons (id, module_id, title, sort_order)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [uuid(i + 200000), MODUL, `Lesson ${i}`, i],
      );
    }

    for (let i = 0; i < jumlah; i++) {
      const id = uuid(i + 300000);
      // `streaks` dan `reviewer_weights` dibuat TRIGGER (migrasi 005) — tidak
      // disisipkan di sini. Menyisipkannya sendiri akan menyembunyikan kalau
      // triggernya rusak.
      await client.query(
        `INSERT INTO users (id, email, display_name, timezone, coin_balance)
         VALUES ($1, $2, $3, 'Asia/Jakarta', 1000)`,
        [id, `load-test-${i}@uji.test`, `LT ${i}`],
      );
      await client.query(
        `INSERT INTO squad_members (squad_id, user_id, weekly_points)
         VALUES ($1, $2, $3)`,
        [uuid(Math.floor(i / perSquad) + 100000), id, i % 500],
      );
      await client.query(
        `INSERT INTO sessions (user_id, token, expires_at)
         VALUES ($1, $2, now() + interval '1 day')`,
        [id, token(i)],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  console.log(`[load-test] selesai: ${jumlah} pengguna siap.`);
  await client.end();
  return { squadId: SQUAD, jumlah };
}

// ── run ────────────────────────────────────────────────────────────────────

/** Persentil dari SELURUH sampel, bukan aproksimasi bucket. */
function persentil(urut, p) {
  if (urut.length === 0) return 0;
  const i = Math.min(urut.length - 1, Math.ceil((p / 100) * urut.length) - 1);
  return urut[i];
}

async function jalankan({ rps, detik, jumlahUser, jalur }) {
  const latensi = [];
  const status = new Map();
  let gagal = 0;
  const terbang = new Set();

  const jeda = 1000 / rps;
  const mulai = performance.now();
  const total = rps * detik;

  for (let n = 0; n < total; n++) {
    const jadwal = mulai + n * jeda;
    const sekarang = performance.now();
    if (jadwal > sekarang) await new Promise((r) => setTimeout(r, jadwal - sekarang));

    const i = n % jumlahUser;
    const t0 = performance.now();
    const p = fetch(`${API}${jalur}`, {
      headers: { authorization: `Bearer ${token(i)}` },
    })
      .then(async (res) => {
        await res.arrayBuffer(); // badan respons ikut dihitung; tanpa ini yang diukur cuma header
        latensi.push(performance.now() - t0);
        status.set(res.status, (status.get(res.status) ?? 0) + 1);
      })
      .catch(() => {
        gagal++;
        // Permintaan yang GAGAL tetap dicatat latensinya. Membuangnya akan
        // membuat p95 membaik justru saat server mulai menolak koneksi.
        latensi.push(performance.now() - t0);
      })
      .finally(() => terbang.delete(p));
    terbang.add(p);
  }

  await Promise.allSettled([...terbang]);
  const wall = (performance.now() - mulai) / 1000;
  const urut = latensi.slice().sort((a, b) => a - b);

  return {
    jalur,
    rps_target: rps,
    rps_tercapai: Number((latensi.length / wall).toFixed(1)),
    durasi_detik: Number(wall.toFixed(1)),
    permintaan: latensi.length,
    gagal,
    status: Object.fromEntries(status),
    p50_ms: Number(persentil(urut, 50).toFixed(1)),
    p95_ms: Number(persentil(urut, 95).toFixed(1)),
    p99_ms: Number(persentil(urut, 99).toFixed(1)),
    maks_ms: Number((urut[urut.length - 1] ?? 0).toFixed(1)),
  };
}

// ── main ───────────────────────────────────────────────────────────────────

const perintah = process.argv[2];

if (perintah === 'seed') {
  await seed(Number(arg('users', 500)));
} else if (perintah === 'run') {
  // `--rps` menerima beberapa nilai: `500,1000,1500`. Satu titik yang LULUS
  // bukan baseline — ia tidak memberi tahu berapa jauh kita dari batasnya.
  // Kurva memberi tahu, dan itu yang dipakai membandingkan bulan depan.
  const daftarRps = String(arg('rps', '500'))
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => x > 0);
  const detik = Number(arg('duration', 20));
  const users = Number(arg('users', 500));
  const out = arg('out', 'docs/reports/R-02');

  console.log('[load-test] pemanasan 2 detik…');
  await jalankan({ rps: 50, detik: 2, jumlahUser: users, jalur: '/api/v1/hub' });

  const hasilSemua = [];
  for (const rps of daftarRps) {
    console.log(`[load-test] ${rps} rps × ${detik} dtk → /api/v1/hub`);
    hasilSemua.push(await jalankan({ rps, detik, jumlahUser: users, jalur: '/api/v1/hub' }));
    // Jeda antar-tahap: tanpa ini, antrean tahap sebelumnya yang belum habis
    // ikut terukur di tahap berikutnya, dan kurvanya jadi lebih buruk dari
    // yang sebenarnya.
    await new Promise((r) => setTimeout(r, 3000));
  }

  const hasil = {
    dicatat_pada: new Date().toISOString(),
    node: process.version,
    catatan:
      'Open-loop: permintaan berangkat pada jadwal tetap, tidak menunggu respons sebelumnya. ' +
      'Closed-loop akan mengurangi laju kirim saat server melambat (coordinated omission) ' +
      'dan melaporkan p95 yang terlalu bagus.',
    target: { p95_ms: 250, rps: 500 },
    hasil: hasilSemua,
  };

  fs.mkdirSync(out, { recursive: true });
  const berkas = path.join(out, 'baseline.json');
  fs.writeFileSync(berkas, JSON.stringify(hasil, null, 2) + '\n');

  for (const r of hasil.hasil) {
    const lulus = r.p95_ms < 250 && r.rps_tercapai >= r.rps_target * 0.95;
    console.log(
      `${lulus ? 'LULUS      ' : 'TIDAK LULUS'}  ${r.jalur}  ` +
        `p50=${r.p50_ms}ms p95=${r.p95_ms}ms p99=${r.p99_ms}ms  ` +
        `rps=${r.rps_tercapai}/${r.rps_target}  gagal=${r.gagal}  ` +
        `status=${JSON.stringify(r.status)}`,
    );
  }
  console.log(`[load-test] baseline ditulis: ${berkas}`);
} else {
  console.log(
    'Pemakaian:\n' +
      '  node scripts/load-test.mjs seed --users 500\n' +
      '  node scripts/load-test.mjs run  --rps 500,1000,1500 --duration 20 --users 500 --out docs/reports/R-02',
  );
  process.exit(1);
}
