/**
 * Setup global Vitest untuk apps/api.
 *
 * `createDatabase()` sengaja MELEMPAR kalau DATABASE_URL kosong — aplikasi
 * harus mati saat boot kalau konfigurasinya salah, bukan baru ketahuan di
 * request pertama. Perilaku itu benar dan tidak dilonggarkan.
 *
 * Test unit tidak menyentuh database sama sekali, jadi yang disediakan di sini
 * hanya nilai yang membuat wiring modul bisa dirakit. `pg.Pool` bersifat lazy:
 * tidak ada koneksi yang dibuka sampai ada query pertama.
 *
 * Test integrasi yang butuh database sungguhan (jalur uang — CLAUDE.md
 * §Test) menimpa variabel ini dengan URL testcontainers-nya sendiri.
 */
process.env['DATABASE_URL'] ??= 'postgres://vitest:vitest@127.0.0.1:1/vitest_tidak_terkoneksi';
// Sama filosofinya dengan DATABASE_URL di atas: provider AUTH (A-03) menolak
// rahasia kosong saat boot — perilaku yang benar untuk produksi. Unit test
// tidak pernah memverifikasi sesi, jadi cukup nilai wiring yang jelas bukan
// rahasia sungguhan. Test integrasi menimpanya di beforeAll-nya.
process.env['AUTH_SECRET'] ??= 'wiring-unit-test-bukan-rahasia-0123456789abcdef';
