// Mencari file JS yang benar-benar dijalankan sebuah CLI, supaya bisa
// dipanggil lewat `node` alih-alih lewat shim di node_modules/.bin.
//
// Kenapa tidak memakai shim itu langsung: di Windows shim-nya berupa .CMD,
// dan sejak perbaikan CVE-2024-27980 Node menolak men-spawn .cmd/.bat tanpa
// `shell: true`, dengan error `spawn EINVAL`. Menyalakan shell menukar satu
// masalah dengan masalah lain: path yang berisi spasi harus dikutip sendiri.
// Memanggil file JS-nya lewat process.execPath menghindari keduanya dan
// perilakunya sama di semua sistem operasi.
import { createRequire } from 'node:module';
import path from 'node:path';

export function resolveBin(fromDir, pkgName, binName) {
  const require = createRequire(path.join(fromDir, 'package.json'));
  const manifestPath = require.resolve(`${pkgName}/package.json`);
  const manifest = require(`${pkgName}/package.json`);
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!entry) {
    throw new Error(`paket ${pkgName} tidak punya bin bernama ${binName}`);
  }
  return path.join(path.dirname(manifestPath), entry);
}
