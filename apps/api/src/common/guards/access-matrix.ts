import type { UserRole } from './roles.decorator';

/**
 * Matriks akses — docs/PRD.md §2.4, disalin baris per baris.
 *
 * Ini KONSTANTA yang diuji, bukan dokumentasi. Test `access-matrix.spec.ts`
 * menjalankan setiap baris terhadap setiap peran dan membuktikan yang salah
 * ditolak — bukan sekadar memeriksa yang benar diterima. PRD §2.4 menuntut itu
 * secara harfiah: "setiap peran salah harus ditolak di setiap rute".
 *
 * **Superadmin TIDAK otomatis lolos.** Itu jebakan yang paling mudah
 * dilakukan — `role >= required` terasa wajar dan salah total. Superadmin
 * dilarang di sebagian besar rute student justru supaya panel admin tidak jadi
 * pintu belakang ke seluruh produk (CLAUDE.md §Yang sering salah).
 */
export const ROLES = ['student', 'mentor', 'superadmin'] as const;

export interface AccessRule {
  /** Pola rute seperti ditulis di PRD §2.4. */
  route: string;
  /** Peran yang BOLEH masuk. Kosong = publik. */
  allow: readonly UserRole[];
  /** Diisi kalau rutenya tidak dijaga peran sama sekali. */
  note?: string;
}

const SEMUA = ['student', 'mentor', 'superadmin'] as const;
const BELAJAR = ['student', 'mentor'] as const;
const KONSOL = ['mentor', 'superadmin'] as const;

export const ACCESS_MATRIX: readonly AccessRule[] = [
  // `ALL`, bukan `POST` (isu #65 poin 4). Ditulis `POST /auth/*` saat A-02
  // dibangun di atas PRD §10.3 yang masih menjanjikan dunia JWT — di dunia itu
  // semua endpoint auth memang POST. Better-Auth tidak begitu: `get-session`,
  // `verify-email`, dan `reset-password/:token` adalah **GET**.
  //
  // Dienumerasi dari instance yang berjalan, bukan ditebak: 30 endpoint, 6 di
  // antaranya GET. Kalau matriks ini suatu hari ditegakkan apa adanya dan
  // default-nya TERTUTUP, `GET /auth/get-session` akan ditolak — login terlihat
  // berhasil, lalu sesinya tidak pernah bisa dibaca.
  { route: 'ALL /auth/*', allow: [], note: 'publik — belum ada sesi saat dipanggil' },
  {
    route: 'ALL /auth',
    allow: [],
    note: 'rute TANPA segmen (mis. probe). Bukan tercakup `/auth/*` — "/auth" tidak berada di bawah "/auth/". Ditemukan test drift isu #68, bukan oleh mata',
  },
  { route: 'GET /me', allow: SEMUA },
  { route: 'PATCH /me', allow: SEMUA },
  { route: 'GET /hub', allow: BELAJAR },
  { route: 'GET /tracks', allow: BELAJAR },
  { route: 'GET /tracks/:id', allow: BELAJAR },
  { route: 'GET /lessons/:id/cards', allow: BELAJAR },
  { route: 'POST /attempts', allow: BELAJAR },
  { route: 'GET /streak', allow: BELAJAR },
  { route: 'POST /streak/freeze', allow: BELAJAR },
  // Ditambahkan bersama `S-05`. Ditemukan hilang oleh penyisiran isu #88 —
  // dijanjikan PRD §10.3 sejak awal, tidak pernah tercatat di sini.
  { route: 'POST /streak/freeze/purchase', allow: BELAJAR },
  { route: 'GET /squads/me', allow: BELAJAR },
  { route: 'GET /squads/:id/leaderboard', allow: BELAJAR },
  { route: 'GET /leagues/:season/:tier', allow: BELAJAR },
  { route: 'GET /reviews/queue', allow: BELAJAR },
  { route: 'POST /reviews/:id', allow: BELAJAR },
  // Ditambahkan saat isu #68 — rute ini SUDAH berdiri tapi tidak pernah
  // tercatat di sini, dan tidak ada yang memberi tahu. Sekarang ada test
  // drift yang menolak PR yang menambah rute tanpa menambahkannya ke sini.
  { route: 'GET /notifications', allow: BELAJAR },
  { route: 'PATCH /notifications/:id/read', allow: BELAJAR },
  {
    route: 'GET /pricing',
    allow: [],
    note: 'PUBLIK di kode — tanpa guard sama sekali. PRD §10.3 menulis "semua" (= tiga peran, artinya butuh sesi). Selisih itu BELUM diputuskan; lihat isu #75',
  },
  {
    route: 'GET /health',
    allow: [],
    note: 'probe orkestrator. Dikecualikan dari prefiks global di main.ts, dan memang harus terjangkau tanpa sesi',
  },
  { route: 'GET /wallet', allow: BELAJAR },
  { route: 'GET /wallet/ledger', allow: BELAJAR },
  { route: 'POST /payments/checkout', allow: BELAJAR },
  {
    route: 'POST /webhooks/copyleaks',
    allow: [],
    note: 'tanda tangan vendor, BUKAN sesi — vendor tidak punya sesi dan tidak akan pernah punya. Webhook yang dijaga peran adalah webhook yang tidak pernah sampai. Ditemukan hilang oleh penyisiran isu #88',
  },
  {
    route: 'POST /webhooks/payment',
    allow: [],
    note: 'tanda tangan Midtrans, BUKAN sesi — koin gratis untuk siapa pun kalau ini dijaga peran saja',
  },
  { route: 'GET /store/items', allow: BELAJAR },
  { route: 'POST /store/purchase', allow: BELAJAR },
  { route: 'POST /scans', allow: BELAJAR },
  { route: 'GET /scans/:id', allow: BELAJAR },
  { route: 'POST /career/cv', allow: BELAJAR },
  { route: 'POST /career/prompt-lab/run', allow: BELAJAR },
  { route: 'POST /mastery/*', allow: BELAJAR },
  // Ketiganya boleh, tapi student hanya untuk job MILIKNYA — itu kepemilikan,
  // dicek di service, bukan di guard (PRD §2.5).
  { route: 'GET /ai/jobs/:id', allow: SEMUA },
  { route: 'GET /mentor/queue', allow: KONSOL },
  { route: 'GET /mentor/squads', allow: KONSOL },
  // Superadmin DILARANG di sini: memvalidasi review adalah pekerjaan mentor,
  // dan "superadmin boleh segalanya" justru yang dihindari §2.4.
  { route: 'POST /mentor/reviews/:id/validate', allow: ['mentor'] },
  { route: 'GET /admin/*', allow: ['superadmin'] },
  { route: 'PATCH /admin/pricing', allow: ['superadmin'] },
  // SA-05 (isu #88). Rute inilah satu-satunya jalur sah menunjuk mentor:
  // role `strive_readonly` milik Retool tidak bisa menulis apa pun.
  { route: 'PATCH /admin/users/:id/role', allow: ['superadmin'] },
];
