import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * `Idempotency-Key` sudah dipakai pengguna LAIN — `VALIDATION_ERROR`, HTTP 400.
 *
 * Isu #143. `coin_ledger.idempotency_key` UNIQUE secara GLOBAL, sementara
 * kuncinya dikirim klien. Jadi ada satu keadaan yang bukan "kiriman ulang" dan
 * bukan "kunci baru": kunci yang sah milik orang lain.
 *
 * Sebelum ini keadaan itu dijawab dengan **berhasil secara diam-diam** —
 * `findExisting` memulangkan entri orang lain, `write()` berhenti di situ, dan
 * pemanggil diberi tahu operasinya selesai padahal nol baris ditulis dan
 * saldonya tidak bergerak. Setelah lookup-nya disaring per pengguna, keadaan
 * yang sama sampai ke INSERT dan ditolak unique index dengan galat Postgres
 * mentah: 500 tanpa petunjuk. Keduanya salah dengan cara berbeda.
 *
 * `VALIDATION_ERROR`, bukan kode baru: daftar §10.2 TERTUTUP, dan dari sudut
 * pandang pemanggil memang satu field yang ia kirim yang membuat request ini
 * tidak bisa diproses. Menambah `IDEMPOTENCY_KEY_TAKEN` berarti membuka daftar
 * itu — keputusan, bukan detail implementasi (isu #92).
 *
 * `details` SENGAJA tidak menyebut siapa pemilik kuncinya, dan tidak pun
 * membenarkan bahwa pemiliknya "pengguna lain": yang keluar hanya nama
 * field-nya. Ini tetap menyisakan oracle tipis — pemanggil bisa menguji apakah
 * sebuah kunci sudah terpakai di seluruh sistem. Itu diterima sadar: kuncinya
 * UUIDv4 (122 bit), jadi pencacahan tidak bernilai, dan yang digantikannya
 * adalah oracle yang memulangkan SALDO orang lain.
 */
export class IdempotencyKeyTakenError extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Idempotency-Key sudah dipakai untuk operasi lain',
          details: { field: 'Idempotency-Key' },
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
