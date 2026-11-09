"""Anggaran dekompresi PDF di TITIK yang sama dengan parser (audit AI-07, temuan 1).

Pra-scan literal (`_periksa_bom_stream` di extract.py) memandai byte secara
literal sementara pdfminer membaca struktur PDF sungguhan (`/Length`,
`/Filter`). Dua pandangan itu bisa berbeda, dan ketika berbeda, parser
mendekompresi data yang tidak pernah diukur scanner:

- kata "stream" di komentar/kunci dict membuat scanner memasangkan segmen yang
  salah dan melompati stream bom asli;
- `/Filter [/FlateDecode /FlateDecode]` diterapkan parser BERURUTAN, sedangkan
  scanner hanya menjalankan satu pass zlib per segmen.

Scanner seperti itu tidak bisa ditambal dari luar (setiap pasangan literal
punya varian yang lolos), jadi penegakan anggaran dipindah ke titik
dekompresinya sendiri. pdfminer.six 20260107 memusatkan seluruh dekompresi
stream di `pdfminer.pdftypes.PDFStream.decode()`, yang memanggil `zlib`,
`lzwdecode`, `rldecode`, dan `ccittfaxdecode` TINGKAT MODUL — maka modul ini
mengganti binding itu SEKALI di import, dan menjalankan anggarannya lewat
ContextVar sehingga tiap panggilan ekstraksi punya anggaran sendiri.

Di luar `with anggaran_muai(...)` perilaku pdfminer sama sekali tidak berubah
(ContextVar kosong = tanpa batas), dan `zlib.error` tetap lolos apa adanya
supaya jalur pemulihan stream rusak milik pdfminer (`decompress_corrupted`)
tetap bekerja.
"""

from __future__ import annotations

import logging
import zlib as _zlib_asli
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any, Callable, Iterator, ParamSpec, TypeVar

import pdfminer.pdftypes as _pdftypes

from app.core.errors import GalatLayanan

_log = logging.getLogger(__name__)

_P = ParamSpec("_P")
_T = TypeVar("_T")

POTONG = 1024 * 1024


class _Anggaran:
    """Sisa anggaran satu ekstraksi: per pemanggilan decode dan per dokumen."""

    __slots__ = ("cap_stream", "cap_dokumen", "sisa_dokumen")

    def __init__(self, cap_stream: int, cap_dokumen: int) -> None:
        self.cap_stream = cap_stream
        # Pesan galat anggaran-total butuh nilai cap ASLI; tanpa slot ini
        # aksesnya melempar AttributeError yang berubah jadi "PDF rusak"
        # (ditangkap probe saat menambal temuan 1).
        self.cap_dokumen = cap_dokumen
        self.sisa_dokumen = cap_dokumen


_anggaran: ContextVar[_Anggaran | None] = ContextVar("anggaran_muai_pdf", default=None)


def _mb(n: int) -> int:
    return n // (1024 * 1024)


def _galat(muai: int, cap: int, jenis: str) -> GalatLayanan:
    _log.warning(
        "bom dekompresi PDF ditolak di titik dekompresi (%s): memuai %d byte, batas %d",
        jenis,
        muai,
        cap,
    )
    return GalatLayanan(
        422,
        "DOCUMENT_TOO_LONG",
        f"Stream PDF memuai {_mb(muai)} MB saat dibuka (batas {_mb(cap)} MB) "
        "— dokumen terlalu berat untuk diproses.",
    )


@contextmanager
def anggaran_muai(cap_stream: int, cap_dokumen: int) -> Iterator[None]:
    """Pasang anggaran untuk seluruh pemakaian pdfminer di dalam blok ini."""
    token = _anggaran.set(_Anggaran(cap_stream, cap_dokumen))
    try:
        yield
    finally:
        _anggaran.reset(token)


class _ZlibBeranggaran:
    """`zlib` di mata `pdfminer.pdftypes`; hanya `.decompress` yang dibatasi.

    Dekompresi berjalan bertahap ber-`max_length` supaya byte keluaran dihitung
    SEBELUM dialokasikan menumpuk: begitu melampaui batas, sisanya tidak
    pernah diurai. `zlib.error` tidak pernah ditelan — diteruskan ke pdfminer
    seperti `zlib.decompress` asli.
    """

    def __getattr__(self, nama: str) -> Any:
        return getattr(_zlib_asli, nama)

    def decompress(self, data: bytes) -> bytes:
        a = _anggaran.get()
        if a is None:
            return _zlib_asli.decompress(data)
        pengurai = _zlib_asli.decompressobj()
        keluar = bytearray()
        data_t = data
        while True:
            potong = pengurai.decompress(data_t, POTONG)
            keluar += potong
            if len(keluar) > a.cap_stream:
                raise _galat(len(keluar), a.cap_stream, "per-stream")
            a.sisa_dokumen -= len(potong)
            if a.sisa_dokumen < 0:
                raise _galat(a.cap_dokumen, a.cap_dokumen, "total-dokumen")
            if pengurai.eof or (not potong and not pengurai.unconsumed_tail):
                break
            data_t = pengurai.unconsumed_tail
        if not pengurai.eof:
            # Stream terpotong: `zlib.decompress` asli melempar di sini, dan
            # pdfminer mengandalkannya untuk jalur pemulihannya.
            raise _zlib_asli.error("incomplete or truncated stream")
        return bytes(keluar)


def _bungkus(nama: str) -> Callable[..., Any]:
    """Bungkus decoder non-Flate: ukur HASIL terhadap cap (alokasi sudah
    terjadi sekali, tapi terikat cap, dan lapisan/objek berikutnya berhenti
    di anggaran dokumen)."""
    fungsi = getattr(_pdftypes, nama)

    @wraps(fungsi)
    def pembungkus(data: bytes, *args: Any, **kwargs: Any) -> bytes:
        hasil = fungsi(data, *args, **kwargs)
        a = _anggaran.get()
        if a is not None:
            if len(hasil) > a.cap_stream:
                raise _galat(len(hasil), a.cap_stream, f"per-stream ({nama})")
            a.sisa_dokumen -= len(hasil)
            if a.sisa_dokumen < 0:
                raise _galat(a.cap_dokumen, a.cap_dokumen, "total-dokumen")
        return hasil

    return pembungkus


# Dipasang SEKALI di import modul (Python menjalankan modul sekali); anggaran
# sendiri hanya aktif di dalam `with anggaran_muai(...)`.
_pdftypes.zlib = _ZlibBeranggaran()
for _nama in ("lzwdecode", "rldecode", "ccittfaxdecode"):
    setattr(_pdftypes, _nama, _bungkus(_nama))
