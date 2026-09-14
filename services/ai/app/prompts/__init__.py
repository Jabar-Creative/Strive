"""Template prompt BERVERSI.

Disimpan di file terpisah, bukan di dalam fungsi, agar bisa di-review dan
di-diff (docs/PRD.md §13.4). Mengubah prompt = menaikkan PROMPT_VERSION =
cache batal. Contoh versi: "ats-cv/2026-09-01".

Larangan halusinasi ditulis EKSPLISIT di system prompt dan diuji dengan
5 dokumen kontrol di test suite.
"""
