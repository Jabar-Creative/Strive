#!/usr/bin/env node
// Memuat `.env` dari akar repo — nol dependensi, sesuai aturan `scripts/`.
//
// ── Kenapa ini ada ──
//
// CLAUDE.md menulis `cp .env.example .env` dan menyebutnya opsional karena
// "semua punya default". Dua-duanya tidak benar, dan yang kedua membuat yang
// pertama menyesatkan: `pnpm dev:api` mati saat boot dengan
//
//   DATABASE_URL belum diset. Salin .env.example ke .env, atau set
//   variabelnya di shell.
//
// Pesan itu menyuruh menyalin `.env` — dan menyalinnya TIDAK menolong, karena
// tidak satu pun pembungkus di `scripts/` pernah membacanya. Jadi orang yang
// mengikuti petunjuk dari galatnya sendiri sampai di tempat yang sama, lalu
// mencari sebabnya di tempat yang salah. Ditemukan Dev B saat onboarding
// (PR #178).
//
// Diperbaiki dengan membuat petunjuknya BENAR, bukan dengan menghapusnya:
// `.env` sekarang dimuat, jadi alur yang sudah tertulis di dokumen bekerja.
//
// ── Node punya `--env-file`, kenapa tidak itu saja ──
//
// Dua sebab. `NODE_OPTIONS` tidak mengizinkan `--env-file`, jadi flag di
// proses pembungkus TIDAK sampai ke proses anak — dan yang butuh env justru
// anaknya (`nest start`, `next dev`, `uvicorn`). Dan `--env-file-if-exists`
// baru ada di Node 22.9, sementara `engines` repo ini menerima `>=22`.
//
// ── Yang SENGAJA tidak didukung ──
//
// Tidak ada ekspansi `$VAR`, tidak ada substitusi perintah, tidak ada
// multiline. `.env` di repo ini berisi nilai harfiah; menambah ekspansi
// berarti menambah cara baru untuk salah membaca berkas yang memuat rahasia.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Akar repo, dihitung dari letak berkas ini. */
export const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Mengurai isi `.env` menjadi objek.
 *
 * Aturannya sengaja sempit dan bisa dibaca dalam satu tarikan napas:
 * baris kosong dan `#` dilewati, `export ` di depan ditoleransi, pemisahnya
 * `=` PERTAMA (nilai boleh memuat `=` — `AUTH_SECRET` base64 berakhir dengan
 * `==`), dan kutip yang MENGAPIT dibuang.
 */
export function uraiEnv(isi) {
  const hasil = {};
  for (const baris of String(isi).split(/\r?\n/)) {
    const bersih = baris.trim();
    if (bersih.length === 0 || bersih.startsWith('#')) continue;

    const tanpaExport = bersih.startsWith('export ') ? bersih.slice(7).trim() : bersih;
    const potong = tanpaExport.indexOf('=');
    if (potong < 1) continue;

    const nama = tanpaExport.slice(0, potong).trim();
    let nilai = tanpaExport.slice(potong + 1).trim();

    const kutip = nilai[0] === '"' || nilai[0] === "'" ? nilai[0] : undefined;
    if (kutip !== undefined && nilai.length >= 2 && nilai.at(-1) === kutip) {
      nilai = nilai.slice(1, -1);
    } else {
      // Komentar di UJUNG baris. `.env.example` repo ini memakainya di hampir
      // setiap baris:
      //
      //   API_URL=http://localhost:3001      # URL Core API (NestJS)
      //
      // Versi pertama berkas ini hanya melewati `#` di AWAL baris, jadi
      // seluruh komentar itu ikut jadi nilai — dan Better-Auth mati saat boot
      // dengan `ERR_INVALID_URL` yang menyebut URL berisi teks komentar.
      // Ditemukan bukan oleh test, melainkan oleh menjalankan alur yang
      // tertulis di dokumen.
      //
      // Hanya `#` yang DIDAHULUI SPASI yang memotong: password atau token
      // boleh memuat `#` di tengah, dan memotongnya di situ akan merusak
      // rahasia yang sah tanpa satu pun tanda.
      const komentar = nilai.search(/\s#/);
      if (komentar !== -1) nilai = nilai.slice(0, komentar).trimEnd();
    }
    if (nama.length > 0) hasil[nama] = nilai;
  }
  return hasil;
}

/**
 * Menyalin `.env` ke `process.env` — **tanpa menimpa yang sudah ada**.
 *
 * Shell menang atas berkas, dan itu bukan selera: CI menyetel `DATABASE_URL`
 * eksplisit di job-nya, dan satu `.env` yang tertinggal di mesin seseorang
 * tidak boleh diam-diam mengambil alih. Ia juga membuat
 * `DATABASE_URL=… pnpm dev:api` tetap bekerja seperti yang orang harapkan.
 *
 * Tidak ada `.env`? Tidak melakukan apa-apa, tanpa suara — menjalankan stack
 * dengan env dari shell adalah jalur yang sah.
 */
export function muatEnv(akar = AKAR) {
  const berkas = path.join(akar, '.env');
  let isi;
  try {
    isi = fs.readFileSync(berkas, 'utf8');
  } catch {
    return {};
  }

  const dari = uraiEnv(isi);
  const dipakai = {};
  for (const [nama, nilai] of Object.entries(dari)) {
    if (process.env[nama] === undefined) {
      process.env[nama] = nilai;
      dipakai[nama] = nilai;
    }
  }
  return dipakai;
}
