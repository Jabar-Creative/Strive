// Barrel modul `notification`. SATU-SATUNYA pintu masuk dari modul lain —
// aturan lint `no-restricted-imports` menolak impor menembus ke file di dalam.
export * from './notification.module';
export * from './notifications.service';
// Dibuka untuk modul `auth` (isu #65 poin 1): email reset password &
// verifikasi dikirim lewat pengirim yang SAMA dengan email notifikasi, supaya
// hanya ada satu tempat yang tahu vendornya. `auth` memakai kelasnya sebagai
// token DI saja — bentuk yang dipakainya adalah `SendAuthEmail`, sebuah
// fungsi, bukan kelas ini.
export * from './resend-mailer.service';
