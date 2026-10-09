# Repair test harness (Phase 2 API repair)
Sandbox-only. Never run with `config/config.local.php` present (serve.sh refuses).
Paths inside the scripts assume the original sandbox layout (`/data/ebp/...`); adjust when reusing.
- `serve.sh DIR PORT DB`: PHP built-in server with a local MariaDB (port 3307, user ebp/ebp).
- `rca.py`: reproduces the reported errors (Phase 1 vs Phase 2).
- `mixed.py`: partial-upload matrix for the ORIGINAL Phase 2.
- `repair_tests.py pre|post`: website + app flows on the repaired code, before/after migration 010.
- `resilience.py`: repaired website survives any single old/missing file.
- `run_all.sh`: everything, plus the project's own suites (runtime, admin, auth, mobile).
- `logs/`: output of the last full run.
