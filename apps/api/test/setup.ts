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
