// Placeholder untuk script yang ada di CLAUDE.md "Perintah" tapi implementasinya
// masih jadi item backlog. Sengaja keluar dengan kode 0: `pnpm build` dan CI
// tidak boleh merah hanya karena item yang memang belum dijadwalkan.
const [, , name = '<script>', item = '<item>'] = process.argv;
console.log(
  `[strive] \`pnpm ${name}\` belum diimplementasikan — itu item ${item} di docs/BACKLOG.md.`,
);
