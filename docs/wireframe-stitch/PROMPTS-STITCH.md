# Paket Prompt Stitch, 15 Halaman Strive Academy

Cara pakai: buka https://stitch.withgoogle.com/, buat project baru, lalu salin-tempel
SATU blok prompt di bawah per halaman. Jangan menggabungkan beberapa halaman dalam
satu prompt, Stitch bekerja paling baik dengan satu layar per prompt.

Konteks yang sama berlaku untuk semua prompt (sudah ditulis ulang di tiap blok supaya
tiap prompt mandiri):

- Produk: aplikasi web mobile-first untuk mahasiswa Indonesia, bahasa antarmuka
  Bahasa Indonesia, lebar desain 375px.
- Dua profil kepadatan: layar Student memakai kartu bersudut besar (radius 18px),
  tombol pill, ramah dan ringan; layar Console (mentor, superadmin) padat, sudut
 kecil (8px), tabel, tanpa ornamen.
- Setiap daftar wajib punya state kosong, memuat, dan galat (dengan tombol coba lagi
  dan kode error, bukan stack trace).
- Nilai uang dan koin selalu ditampilkan sebagai angka bulat.

Sumber perilaku: `docs/PRD.md` (§4 peta fitur, §7 aturan bisnis per epik, §14 design
system). Layar yang sudah dibangun mengikuti komponen nyata di `apps/web/components/`.

Daftar halaman: /hub · /learn · /learn/lesson/[id] · /squad · /clinic · /career ·
/mastery · /store · /wallet · /login · /register · /reset · /verify · /mentor · /admin

---

## 1. /hub, Halaman utama Student

```
Buat wireframe mobile web (375px) untuk "Hub", halaman utama aplikasi belajar-karir
mahasiswa Indonesia bernama Strive Academy. Bahasa antarmuka Bahasa Indonesia. Ini
layar yang paling sering dibuka: ringkasan harian yang bisa dipahami dalam 5 detik.
Gaya: kartu bersudut besar (18px), tombol pill, satu kolom.

Struktur atas ke bawah:
1. Bar navigasi aplikasi tipis berisi tautan: Hub, Belajar, Squad, Klinik, Karir,
   Mastery, Store, Dompet. Tautan Hub aktif.
2. Kartu streak (kartu paling menonjol). Baris atas: chip status streak di kiri
   (ikon api + jumlah hari, contoh "12 hari") dan pill saldo koin di kanan (ikon
   koin + angka, contoh "1.240"). Di bawahnya satu kalimat status yang berubah
   sesuai kondisi: aktif hari ini, belum aktif dengan hitungan "Sisa 6 jam 20 menit
   hari ini untuk menjaga streak-mu", sudah diselamatkan dengan kredit beku, atau
   streak putus (copy-nya menyemangati tanpa menyalahkan: "Satu micro-task hari ini
   menyalakannya kembali, rekor terpanjangmu 34 hari tetap tersimpan"; varian putus
   TIDAK boleh memakai warna merah).
3. Kartu quest harian: judul "Quest hari ini", progress bar 0/3, 1/3, 2/3, 3/3
   dengan angka pecahan di kanan, satu kalimat dorongan di bawah ("Selesaikan
   micro-task untuk maju" atau "Quest selesai, kembali besok").
4. Kartu squad (hanya jika pengguna punya squad): nama squad, satu baris
   "Peringkat 4 dari 10 · 320 poin minggu ini".
5. Kartu "Lanjutkan belajar": daftar 3 lesson berikutnya, tiap baris berisi judul
   lesson di kiri dan label track kecil di kanan (contoh "PUBLIC RELATIONS"),
   bisa diketuk.

State penting yang harus ada desainnya:
- Memuat: layar tunggal "Memuat Hub…" dengan satu kalimat penjelas.
- Galat: kartu pesan "Hub gagal dimuat" + pesan + kode error + tombol "Coba lagi".
- Streak putus: kartu nomor 2 memakai copy putus (tanpa merah).

Catatan mobile 375px: semuanya satu kolom, kartu menumpuk vertikal dengan jarak
consisten, target sentuh minimal 48px, tidak ada scroll horizontal.
```

---

## 2. /learn, Daftar track belajar

```
Buat wireframe mobile web (375px) untuk halaman "Belajar" aplikasi Strive Academy
(belajar-karir mahasiswa Indonesia, Bahasa Indonesia). Pengguna memilih jalur
belajar (track) lalu masuk ke lesson. Gaya kartu bersudut besar, satu kolom.

Struktur atas ke bawah:
1. Bar navigasi aplikasi (Hub, Belajar aktif, Squad, Klinik, Karir, Mastery,
   Store, Dompet).
2. Daftar kartu track. Tiap kartu: judul track (contoh "Public Relations"),
   chip kategori kecil di kanan atas (contoh "KOMUNIKASI"), deskripsi satu baris,
   dan progress bar progres dengan angka "3/12 lesson" di kanan.
3. Saat satu kartu track diketuk, panel detail mengembang DI DALAM kartu itu
   (accordion, bukan halaman baru): progress bar track, lalu per modul: judul
   modul + angka "2/4", diikuti daftar lesson. Tiap baris lesson: judul lesson,
   dan penanda kanan berupa tanda centang jika sudah selesai (judulnya dicoret
   tipis) atau estimasi durasi "3 mnt" jika belum.

State penting:
- Memuat: "Memuat track…" dengan kalimat penjelas.
- Galat daftar: pesan galat + kode error + tombol "Coba lagi".
- Kosong: "Belum ada track, konten belajar belum diterbitkan. Coba kembali nanti."
- Panel modul sedang dimuat: teks kecil "Memuat modul…"
- Panel modul gagal: teks kecil "modul gagal dimuat · code: XXX" (gagal detail
  tidak menghapus daftar track di atasnya).

Catatan mobile 375px: satu kolom, panel detail mengembang ke bawah tanpa geser
horizontal, tinggi baris lesson minimal 48px.
```

---

## 3. /learn/lesson/[id], Pemain lesson bite-sized

```
Buat wireframe mobile web (375px) untuk layar "mengerjakan lesson" aplikasi Strive
Academy (Bahasa Indonesia). Satu lesson = 3 sampai 5 kartu soal singkat, durasi
total 2-3 menit, seperti kartu Tinder untuk belajar. Fokus: fokus penuh ke satu
kartu, tanpa distraksi.

Struktur atas ke bawah (mode mengerjakan):
1. Header kecil: judul lesson (huruf kecil kapital) di kiri, penghitung kartu
   "2/5" di kanan.
2. Bar titik progres: satu titik per kartu, titik yang sudah dilewati terisi.
3. Kartu soal besar di tengah layar (kartu dengan bayangan). Dua varian kartu:
   a. Pilihan ganda: judul "Pilih satu", pertanyaan, diikuti 3-4 tombol opsi
      vertikal memenuhi lebar kartu.
   b. Benar/salah (swipe): judul "Geser atau ketuk", satu pernyataan besar,
      bisa digeser kanan (benar) atau kiri (salah), DAN wajib ada dua tombol
      alternatif "Benar" dan "Salah" (geser bukan satu-satunya cara), plus satu
      baris petunjuk "Geser ke kanan untuk Benar, kiri untuk Salah, atau pakai
      tombol".
4. Saat mengirim jawaban akhir: teks status "Mengirim jawaban…" di bawah kartu.

Layar hasil (setelah semua kartu dijawab):
1. Label "HASIL", skor besar "80/100".
2. Baris hadiah "+16 koin · +9 poin" (atau jika lesson ini sudah dihargai hari
   ini: teks "Latihan ulang, lesson ini sudah dihargai hari ini, tanpa koin baru").
3. Daftar feedback per kartu: kartu kecil per kartu soal, judul "Benar" atau
   "Salah" diikuti potongan pertanyaan, dan satu-dua kalimat penjelasan.
4. Satu baris ringkasan "Streak 13 hari · quest 1/3".
5. Tombol primer "Ulangi latihan" dan tombol sekunder "Kembali ke Hub".

State penting:
- Memuat: "Memuat kartu…"
- Gagal memuat: pesan galat + tombol "Coba lagi".
- Gagal mengirim jawaban: pesan galat + tombol "Kirim ulang" (memakai jawaban
  yang sama, bukan mengulang lesson).
- Lesson tanpa kartu: pesan "Lesson ini belum punya kartu" + tautan "Kembali ke
  daftar lesson".

Catatan mobile 375px: kartu soal memenuhi lebar layar dengan margin kecil, tombol
opsi tinggi minimal 48px, area geser besar dan mudah dijangkau ibu jari.
```

---

## 4. /squad, Squad dan papan peringkat mingguan

```
Buat wireframe mobile web (375px) untuk halaman "Squad" aplikasi Strive Academy
(Bahasa Indonesia). Squad = kelompok belajar 8-12 orang yang dibentuk otomatis
setiap minggu, bersaing di liga mingguan. Halaman ini = identitas squad + papan
peringkat mingguan yang bergerak (realtime jika bisa, polling 30 detik jika tidak).

Struktur atas ke bawah:
1. Bar navigasi aplikasi (Hub, Belajar, Squad aktif, Klinik, Karir, Mastery,
   Store, Dompet).
2. Kartu identitas squad: nama squad, satu baris meta "SILVER · musim 2026-W42 ·
   berakhir 19 Okt", chip indikator cara pembaruan papan di kanan atas (titik
   hijau + "Langsung" atau titik abu + "per 30 dtk"), dan baris "Peringkatmu #3 ·
   214 poin minggu ini".
3. Kartu "Papan mingguan": daftar 8-12 baris anggota. Tiap baris: nomor peringkat,
   avatar bulat berisi inisial nama, nama tampilan, poin mingguan rata kanan
   (angka tabular). Baris milik pengguna sendiri ditandai (contoh latar tipis).
   Urutan berubah tanpa reload saat poin masuk.

State penting:
- Memuat: "Memuat squad…"
- Galat: pesan galat + kode error + tombol "Coba lagi".
- Belum punya squad (pengguna baru): pesan "Belum punya squad" dengan penjelasan
  "Squad dibentuk otomatis setiap minggu dari pengguna aktif, selesaikan
  micro-task hari ini supaya kamu masuk gelombang berikutnya."
- Papan gagal diperbarui sesaat: papan lama TETAP tampil (bukan layar galat),
  percobaan ulang otomatis.

Catatan mobile 375px: satu kolom, nama anggota dipotong dengan ellipsis bila
panjang, poin tetap terlihat penuh, tanpa scroll horizontal.
```

---

## 5. /clinic, Klinik plagiarisme

```
Buat wireframe mobile web (375px) untuk halaman "Klinik" (layanan scan plagiarisme
berbayar) aplikasi Strive Academy (Bahasa Indonesia). Ini fitur berbayar utama:
mahasiswa mengunggah bab skripsi (PDF/DOCX), sistem memindai kemiripan, laporan
bisa diunduh. Pengguna membayar dengan koin.

Struktur atas ke bawah:
1. Bar navigasi aplikasi (Hub, Belajar, Squad, Klinik aktif, Karir, Mastery,
   Store, Dompet).
2. Kartu info layanan: harga "2.400 koin (Rp 60.000) per dokumen", batasan
   "maksimal 15.000 kata dan 25 MB, format PDF atau DOCX", harga cache "240 koin
   jika dokumen identik pernah discan", dan kuota "3 scan per hari".
3. Kartu unggah dokumen: area dropzone besar (kotak putus-putus dengan ikon
   unggah dan teks "Tarik dokumen ke sini atau ketuk untuk memilih"), setelah
   file dipilih tampil: nama file, estimasi jumlah kata, dan RINGKASAN BIAYA
   (harga dalam koin + saldo sekarang + keterangan cukup/kurang). Harga wajib
   tampil SEBELUM tombol kirim. Tombol primer "Kirim scan" (nonaktif selama
   belum ada file).
4. Bagian scan berjalan (jika ada): kartu status dengan indikator antre/proses
   dan animasi menunggu.
5. Bagian riwayat scan: daftar baris, tiap baris: nama dokumen + tanggal,
   chip status (Antre, Memindai, Selesai, Gagal, Dibatalkan), persentase skor
   kemiripan jika selesai (angka besar rata kanan), dan tombol "Unduh laporan"
   jika selesai. Laporan berlaku 15 menit per tautan.

State penting:
- Memuat, galat umum + tombol coba lagi.
- Riwayat kosong: "Belum ada scan. Unggah dokumen pertamamu di atas."
- File ditolak: bukan PDF/DOCX, lebih dari 25 MB, atau lebih dari 15.000 kata
  (pesan menyarankan memecah dokumen, bukan memotong diam-diam).
- Saldo kurang: pesan "Saldo koin tidak cukup" + tombol "Isi koin" ke dompet.
- Kuota harian habis: pesan coba lagi besok.
- Scan gagal di sisi layanan: status "Gagal" + kalimat "Koin dikembalikan penuh".

Catatan mobile 375px: dropzone memenuhi lebar, satu dokumen per baris riwayat,
chip status tidak membungkus, tombol unduh tetap terlihat tanpa geser.
```

---

## 6. /career, ATS CV Builder dan Prompt Lab

```
Buat wireframe mobile web (375px) untuk halaman "Karir" aplikasi Strive Academy
(Bahasa Indonesia). Dua alat dalam satu halaman lewat tab: (1) ATS CV Builder,
mengubah CV lama jadi CV yang terbaca mesin ATS, biaya 400 koin per generate;
(2) Prompt Lab, melatih menyusun prompt terstruktur, 20 koin per run.

Struktur atas ke bawah:
1. Bar navigasi aplikasi (Hub, Belajar, Squad, Klinik, Karir aktif, Mastery,
   Store, Dompet).
2. Tab di bawah navigasi: "ATS CV" dan "Prompt Lab".

Tab ATS CV:
3. Kartu sumber CV: pilihan radio "Unggah CV lama (PDF/DOCX)" atau "Pakai profil
   Strive Academy" (salah satu wajib), field "Target role" (contoh: Junior
   Designer) dan pilihan bahasa.
4. Baris biaya: "400 koin per generate · kuota 10 run AI per hari".
5. Tombol primer "Generate CV ATS".
6. Kartu status job setelah dikirim: antre / sedang diproses (indikator
   berjalan), hasil muncul otomatis.
7. Kartu hasil: skor ATS besar (0-100, contoh "72"), daftar temuan pemeriksaan
   per item dengan tingkat (error/warning) dan pesan singkat (contoh: error
   "Format tanggal harus YYYY-MM"), pratinjau CV hasil (satu kolom, tanpa tabel,
   tanpa ikon), tombol "Unduh PDF".

Tab Prompt Lab:
8. Form 5 bagian berlabel: Role, Context, Task, Format, Constraints (textarea
   atau input, satu per baris dengan label di atas).
9. Baris "Template contoh": 3 kartu kecil bisa diketuk untuk mengisi form
   otomatis.
10. Tombol primer "Jalankan prompt · 20 koin" + indikator berjalan (maks 30
    detik).
11. Kartu hasil output LLM.
12. Riwayat run: daftar pasangan prompt (terpotong) dan hasil, bisa diketuk.

State penting:
- Memuat, galat + coba lagi untuk kedua tab.
- Kuota AI harian habis: pesan "Kuota 10 run AI hari ini sudah habis".
- Saldo kurang: pesan + tombol "Isi koin".
- Run gagal/timeout: pesan yang bisa dimengerti + "koin tidak terpotong".
- Riwayat kosong, hasil belum pernah dibuat.

Catatan mobile 375px: tab sticky di atas, form satu kolom label-di-atas-input,
daftar temuan tidak menumpuk satu baris dengan skornya.
```

---

## 7. /mastery, Mastery Track (persiapan studi lanjut luar negeri)

```
Buat wireframe mobile web (375px) untuk halaman "Mastery" aplikasi Strive Academy
(Bahasa Indonesia). Layanan persiapan studi lanjut ke luar negeri dengan dua
modul: simulasi wawancara (300 koin) dan review personal statement (500 koin).
Semua keluaran AI wajib ditandai "Saran, bukan penilaian resmi".

Struktur atas ke bawah:
1. Bar navigasi aplikasi (Hub, Belajar, Squad, Klinik, Karir, Mastery aktif,
   Store, Dompet).
2. Dua kartu modul berdampingan atau bertumpuk: "Simulasi Wawancara, 5 pertanyaan
   dari bank soal, feedback per jawaban, 300 koin" dan "Review Personal
   Statement, feedback terstruktur atas drafmu, 500 koin". Tombol "Mulai" di
   tiap kartu.
3. Alur wawancara setelah "Mulai": pilih program target (tiga pilihan: Chevening,
   LPDP, Fulbright), konfirmasi biaya sekali tampil, lalu halaman sesi berisi:
   daftar 5 pertanyaan bernomor, satu textarea jawaban per pertanyaan, dan
   indikator kecil "Tersimpan otomatis" di dekat jawaban (draf tidak hilang saat
   halaman tertutup), tombol "Kirim semua jawaban" di bawah.
4. Kartu hasil: feedback per jawaban (satu blok per nomor), dan di PALING ATAS
   hasil ada pita penanda "Saran, bukan penilaian resmi".
5. Alur statement: textarea besar tempel draf (atau unggah), tombol kirim,
   hasil feedback terstruktur dengan empat bagian berlabel: Struktur, Kejelasan,
   Bukti, Kesesuaian program.
6. Riwayat sesi: daftar baris (jenis sesi, program, tanggal, status selesai),
   bisa diketuk untuk dibuka kembali.

State penting:
- Memuat, galat + coba lagi.
- Riwayat kosong: "Belum ada sesi. Mulai simulasi pertamamu di atas."
- Saldo kurang: pesan + tombol "Isi koin".
- AI gagal: pesan + "300 koin dikembalikan penuh, coba ulang tanpa biaya baru".

Catatan mobile 375px: textarea memenuhi lebar dengan tinggi nyaman (5-6 baris),
nomor pertanyaan dan indikator autosave tidak bertabrakan, pita penanda
"Saran, bukan penilaian resmi" selalu terlihat di atas hasil.
```

---

## 8. /store, Strive Store

```
Buat wireframe mobile web (375px) untuk halaman "Store" aplikasi Strive Academy
(Bahasa Indonesia). Etalase penukaran koin berisi 8 item digital: pustaka prompt,
template workspace, aset desain. Koin didapat dari belajar dan top-up, jadi
halaman ini adalah tempat koin terasa nilainya.

Struktur atas ke bawah:
1. Bar navigasi aplikasi (Hub, Belajar, Squad, Klinik, Karir, Mastery, Store
   aktif, Dompet), dengan pill saldo koin kecil di ujung kanan nav (contoh
   "1.240 koin").
2. Judul halaman singkat "Tukar koinmu" + subjudul satu baris.
3. Grid 2 kolom kartu item. Tiap kartu: area ilustrasi persegi dengan placeholder
   gambar, nama item, deskripsi satu-dua baris, harga koin menonjol (contoh
   "800 koin"), dan tombol "Beli". Untuk item yang sudah dibeli, tombol berubah
   jadi "Unduh" dan kartu diberi tanda kecil "Dimiliki".
4. Konfirmasi pembelian: lembar/dialog ringkas berisi nama item, harga, saldo
   sekarang, saldo setelah pembelian, tombol primer "Konfirmasi" dan "Batal".

State penting:
- Memuat, galat + coba lagi.
- Etalase kosong: "Etalase sedang disiapkan."
- Saldo kurang: pesan "Saldo koin tidak cukup" + tombol "Isi koin".
- Item sudah dibeli: tombol jadi "Unduh" (tidak bisa beli dua kali).
- Tautan unduhan kedaluwarsa (berlaku 15 menit): pesan + tombol "Minta tautan
  baru".

Catatan mobile 375px: grid tepat 2 kolom dengan gambar persegi, harga dan tombol
tidak saling menimpa, dialog konfirmasi muat di layar tanpa scroll.
```

---

## 9. /wallet, Dompet (saldo, riwayat, top-up)

```
Buat wireframe mobile web (375px) untuk halaman "Dompet" aplikasi Strive Academy
(Bahasa Indonesia). Tiga isi: saldo Strive Coins, riwayat perpindahan koin yang
bisa dipercaya, dan top-up koin. Angka selalu bulat dan rapi (tabular).

Struktur atas ke bawah:
1. Bar navigasi aplikasi (Hub, Belajar, Squad, Klinik, Karir, Mastery, Store,
   Dompet aktif).
2. Kartu saldo: label kecil "SALDO KAMU", angka saldo besar dengan ikon koin
   (contoh "1.240 koin"), satu kalimat kecil "Terpakai untuk scan, store, dan
   fitur AI".
3. Bagian "Isi koin": tiga kartu paket berjajar atau bertumpuk: Starter 1.000
   koin Rp 25.000, Reguler 2.200 koin Rp 50.000, Skripsi 4.800 koin Rp 100.000,
   tiap kartu ada tombol "Beli". Catatan kecil: pembayaran QRIS lewat halaman
   checkout penyedia (tidak dibangun sendiri), status order dicek otomatis saat
   kembali.
4. Daftar "Riwayat": baris-baris riwayat koin. Tiap baris: ikon lingkaran arah
   (plus hijau untuk koin masuk, minus merah untuk koin keluar, lingkaran netral
   untuk koin ditahan sementara), label jenis entri (contoh: Lesson selesai,
   Scan plagiarisme, Pembelian item, Hold scan), keterangan + waktu di baris
   kedua, dan di kanan: jumlah perubahan (+20 / -2.400) plus saldo setelahnya
   dalam angka kecil. Baris bisa diketuk untuk memperluas satu kalimat penjelasan
   jenis entrinya.
5. Tombol "Muat riwayat lengkap" di bawah daftar, berubah jadi "Muat lagi" untuk
   halaman berikutnya.
6. Catatan kaki kecil: "Lambang tahan berarti koin dikunci sementara, bukan
   hilang."

State penting:
- Memuat: "Memuat dompet…"
- Galat: pesan galat + kode error + tombol "Coba lagi"; jika sesi berakhir,
  tombol "Masuk lagi".
- Dompet kosong (saldo 0 dan tanpa riwayat): kartu saldo tetap tampil + pesan
  "Dompet kamu masih kosong, selesaikan kartu lesson dan jaga streak harian
  untuk mengumpulkan Strive Coins" + tautan "Mulai belajar".
- Halaman riwayat berikutnya gagal: kotak peringatan kecil di bawah daftar +
  tautan "Muat ulang dari awal" (daftar yang sudah tampil tetap tampil).
- Top-up diblokir karena email belum diverifikasi: pesan "Verifikasi email
  dulu untuk mengisi koin" + tautan ke halaman verifikasi.

Catatan mobile 375px: satu kolom, tiga kartu paket boleh bertumpuk vertikal,
angka kanan baris riwayat tidak terpotong, baris tinggi 56-64px supaya mudah
diketuk.
```

---

## 10. /login, Masuk

```
Buat wireframe mobile web (375px) untuk halaman "Masuk" aplikasi Strive Academy
(Bahasa Indonesia). Layar publik tanpa shell aplikasi, satu kartu form di tengah.

Struktur atas ke bawah:
1. Kartu form: judul "Masuk", subjudul "Lanjutkan streak dan misi harianmu".
2. Field "Email" (label di atas, input email).
3. Field "Password" (input password).
4. Tombol primer memenuhi lebar "Masuk" (saat memproses berubah "Memeriksa…"
   dan nonaktif).
5. Baris tautan di bawah: "Belum punya akun? Daftar" dan "Lupa password?".

State penting:
- Validasi inline di bawah field (email tidak valid, password kosong).
- Galat kredensial: kotak peringatan di atas tombol "Email atau password salah."
- Email belum diverifikasi: kotak peringatan yang mengarah ke halaman verifikasi
  (tidak memblokir masuk).
- Pengguna sudah punya sesi: langsung diarahkan ke Hub (tidak perlu desain
  khusus, cukup catatan).

Catatan mobile 375px: kartu dengan margin layar yang lega, keyboard ponsel tidak
menutup tombol (tombol di dalam alur form), target 48px.
```

---

## 11. /register, Daftar

```
Buat wireframe mobile web (375px) untuk halaman "Daftar" aplikasi Strive Academy
(Bahasa Indonesia). Layar publik satu kartu form. Registrasi sengaja sangat
ringan: nama, email, password. Zona waktu dideteksi otomatis dari browser
(tidak ada fieldnya di form).

Struktur atas ke bawah:
1. Kartu form: judul "Daftar", subjudul "Gratis. Streak dimulai hari ini."
2. Field "Nama tampilan".
3. Field "Email".
4. Field "Password" dengan hint kecil di bawah "Minimal 10 karakter" (tidak ada
   aturan huruf besar/angka/simbol, jangan tampilkan meter kekuatan password
   yang mensyaratkan komposisi).
5. Field "Ulangi password".
6. Tombol primer "Daftar" (saat memproses "Membuat akun…").
7. Baris tautan "Sudah punya akun? Masuk".

State penting:
- Validasi inline per field (nama kosong, email tidak valid, password di bawah
  10 karakter, konfirmasi tidak sama).
- Email sudah terdaftar: kotak peringatan "Email ini sudah terdaftar. Masuk,
  atau reset password kalau lupa."
- Sukses: langsung masuk dan diarahkan ke Hub.
- Catatan kecil di dekat tombol atau bawah kartu: "Belajar dan streak bisa
  langsung dipakai; verifikasi email hanya diperlukan saat mengisi koin."

Catatan mobile 375px: satu kolom, hint password terlihat tanpa membuka keyboard
kedua, tombol tidak tertutup keyboard.
```

---

## 12. /reset, Lupa password (dua langkah)

```
Buat wireframe mobile web (375px) untuk alur "Lupa password" aplikasi Strive
Academy (Bahasa Indonesia). Dua layar dalam satu alur: minta tautan, lalu buat
password baru dari tautan email.

Layar 1, minta tautan:
1. Kartu: judul "Lupa password", subjudul "Kami kirim tautan pengaturan ulang
   ke emailmu."
2. Field "Email".
3. Tombol primer "Kirim tautan" (saat memproses "Mengirim…").
4. Tautan "Kembali ke layar masuk".
5. State sukses: pesan status netral "Kalau email itu terdaftar, tautan
   pengaturan ulang sudah dikirim." (pesan TIDAK boleh membocorkan ada atau
   tidaknya akun).

Layar 2, password baru (dibuka dari tautan email, membawa token):
1. Kartu: judul "Password baru", subjudul "Sesi di perangkat lain akan dicabut
   demi keamanan."
2. Field "Password baru" + hint "Minimal 10 karakter".
3. Field "Ulangi password".
4. Tombol primer "Simpan password baru".

State penting:
- Tautan dibuka tanpa token: kartu "Tautan tidak lengkap" + tombol "Minta tautan
  baru".
- Token kedaluwarsa atau tidak valid: peringatan "Tautan tidak valid atau sudah
  kedaluwarsa. Minta tautan baru."
- Fitur reset belum diaktifkan server: pesan jujur "Pengaturan ulang password
  lewat email belum diaktifkan."

Catatan mobile 375px: kartu tunggal di tengah, tidak ada navigasi aplikasi,
semua pesan berupa kotak status di dalam kartu.
```

---

## 13. /verify, Verifikasi email

```
Buat wireframe mobile web (375px) untuk halaman "Verifikasi email" aplikasi
Strive Academy (Bahasa Indonesia). Halaman ini MEMAPARKAN MANFAAT, bukan
ancaman: verifikasi hanya dibutuhkan untuk mengisi koin (top-up), belajar dan
streak tetap bisa tanpa verifikasi.

Struktur atas ke bawah:
1. Kartu: judul "Verifikasi email", subjudul "Verifikasi membuka top-up Strive
   Coins. Belajar dan streak tetap bisa tanpa verifikasi."
2. Area status yang punya empat varian:
   a. Menunggu (dibuka tanpa token): "Buka tautan verifikasi dari email, atau
      minta yang baru di bawah."
   b. Memeriksa (dibuka dengan token dari email): "Memeriksa tautan…"
   c. Berhasil: kotak sukses "Email terverifikasi. Selamat belajar!"
   d. Gagal: kotak peringatan "Tautan tidak valid atau sudah kedaluwarsa."
3. Baris aksi: tombol sekunder "Kirim ulang email" (hanya jika sedang login)
   dan tombol "Ke Hub".

State penting: keempat varian status di atas, plus pesan hasil kirim ulang
(netral, tidak membocorkan keberadaan akun).

Catatan mobile 375px: kartu tunggal, status menggantikan satu sama lain di posisi
yang sama, dua tombol muat sejajar dalam satu baris.
```

---

## 14. /mentor, Konsol mentor

```
Buat wireframe mobile web yang tetap nyaman di desktop untuk halaman "Konsol
mentor" aplikasi Strive Academy (Bahasa Indonesia). Ini layar kerja padat
(profil Console): sudut kecil (8px), tanpa maskot, tanpa animasi perayaan,
baris data yang mudah dipindai. Mentor memvalidasi peer review dan memantau
anggota squad binaannya.

Struktur atas ke bawah:
1. Header konsol tipis: judul "Antrean validasi" + nama mentor + tautan ke
   "Superadmin" (hanya jika perannya mengizinkan).
2. Bagian antrean validasi review: tabel atau daftar baris padat. Tiap baris:
   waktu, squad asal (identitas penulis disembunyikan, reviewer terlihat),
   empat kolom skor rubrik: Kejelasan, Ketepatan, Kelengkapan, Sitasi (nilai
   0-5 per kriteria), total "/20", dan dua tombol aksi: "Setujui" dan "Tolak"
   plus kolom catatan singkat. Baris yang sudah divalidasi bergaya "selesai"
   dan tidak lagi membawa aksi.
3. Bagian squad binaan: daftar squad binaan si mentor, tiap squad menampilkan
   anggota berisiko putus streak (belum aktif hari ini, dengan sisa jam) dalam
   baris padat.

State penting:
- Memuat: kerangka baris (skeleton).
- Galat: pesan + kode error + tombol coba lagi.
- Antrean kosong: "Tidak ada review menunggu validasi."
- Menyetujui dua kali tidak boleh menghasilkan koin ganda (cukup catatan di
  desain: aksi idempoten, baris langsung berubah jadi selesai setelah aksi).

Catatan mobile 375px: tabel rubrik boleh berubah jadi kartu baris bertumpuk di
layar sempit, keempat skor tetap terbaca bersebelahan, tombol aksi 44px dan
saling berjauhan supaya tidak salah tekan.
```

---

## 15. /admin, Konsol superadmin

```
Buat wireframe untuk halaman "Konsol superadmin" aplikasi Strive Academy
(Bahasa Indonesia). Ini konsol operator platform: padat, gaya tabel ala panel
admin (keputusan produk: panel superadmin memakai alat eksternal di atas view
SQL baca-saja, jadi desain halaman ini meniru struktur datanya: tabel lebar,
filter, tanpa ornamen). Sudut kecil, tanpa animasi.

Struktur atas ke bawah:
1. Header konsol: judul "Superadmin" + nama operator + tautan keluar.
2. Baris kartu metrik ringkas: Transaksi hari ini, Pendapatan hari ini, Biaya
   vendor AI hari ini, Jumlah pengguna aktif minggu ini.
3. Bagian transaksi: tabel lebar dengan filter (rentang tanggal, status order,
   cari email). Tiap baris merangkai satu transaksi utuh: waktu, email pengguna,
   paket/koin, jumlah rupiah, status payment (pending, paid, failed, expired),
   dan entri koin ledger terkait. Ada tombol filter dan ekspor.
4. Bagian audit log: tabel aksi istimewa (siapa, aksi apa, kapan, alamat IP):
   perubahan harga, penetapan mentor, webhook gagal tanda tangan, hasil
   rekonsiliasi saldo.
5. Bagian harga koin: tabel kecil versi harga (paket, koin, rupiah, aktif
   sejak) dengan tombol "Terbitkan versi baru" (menerbitkan baris baru, bukan
   menimpa angka lama, history tetap terlihat).
6. Bagian pengguna: pencarian email + aksi "Jadikan mentor" (perubahan peran).
7. Bagian integrasi: kartu status per vendor (Midtrans, Copyleaks, Resend,
   layanan AI): sehat/gangguan + biaya harian per model LLM.

State penting:
- Memuat per bagian (skeleton tabel).
- Galat per bagian + tombol coba lagi (kegagalan satu bagian tidak menjatuhkan
  halaman).
- Hasil filter kosong: "Tidak ada transaksi untuk filter ini."

Catatan mobile 375px: tabel berubah jadi kartu data bertumpuk, kartu metrik
2x2, filter jadi tombol yang membuka lembar filter.
```

---

## Catatan pemetaan sumber

| Halaman | Sumber perilaku | Layar nyata |
|---|---|---|
| /hub | PRD §7 E3 (SK-1..SK-10), quest 3 micro-task/hari, GET /hub | `hub-screen.tsx` |
| /learn | PRD §7 E2 (LE-9) | `track-list.tsx` |
| /learn/lesson/[id] | PRD §7 E2 (LE-1..LE-8), §14.5 | `lesson-player.tsx` |
| /squad | PRD §7 E5, E15 (RT-5 polling 30 dtk) | `squad-screen.tsx` |
| /clinic | PRD §7 E7 (KL-1..KL-12) | stub, PRD satu-satunya sumber |
| /career | PRD §7 E8 (CV-1..CV-9) + E13 (PL-1..PL-6) | stub |
| /mastery | PRD §7 E12 (MT-1..MT-8) | stub |
| /store | PRD §7 E14 (SR-1..SR-6) | stub |
| /wallet | PRD §7 E4, E6 (PA-2, PA-10), §6.3 paket top-up | `wallet-screen.tsx` + PRD |
| /login, /register, /reset, /verify | PRD §7 E1 (AU-1..AU-9) | halaman auth nyata |
| /mentor | PRD §7 E11 (PR-6, PR-7, PR-10), §10.3 endpoint mentor | stub |
| /admin | PRD §7 E9 (SA-1..SA-6), §10.3 endpoint admin | stub, Retool |
