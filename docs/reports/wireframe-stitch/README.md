# Verifikasi render wireframe

`docs/wireframe-stitch/index.html` diverifikasi render oleh orchestrator
(Playwright headless, file:// langsung): 15/15 section ter-render, TOC 31
tautan berfungsi, console nol error, tinggi dokumen ~16.000 px. Bukti:
`01-idx-render.png` (posisi scroll anchor) dan `02-atas.png` (judul, TOC,
frame pertama /hub — wireframe garis abu sesuai rancangan).

`PROMPTS-STITCH.md` tidak butuh verifikasi render (markdown), namun tiap
prompt dirancang self-contained untuk ditempel ke Stitch.
