#!/bin/bash
# Full local verification of /data/ebp/work/website. Logs -> /data/ebp/tests/logs/
set -u; S=/run/mysqld/mysqld.sock; L=/data/ebp/tests/logs; mkdir -p $L; cd /data/ebp
./sync_test.sh
M="sudo mysql -S $S"
$M -e "DROP DATABASE IF EXISTS ebp_prod; CREATE DATABASE ebp_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"; sudo mysqldump -S $S ebp_test | $M ebp_prod
$M -e "DROP DATABASE IF EXISTS ebp_suite; CREATE DATABASE ebp_suite CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"; $M ebp_suite < test/work/database/schema.sql; $M ebp_suite < test/work/database/seeds/001_reference_data.sql
for p in 8085 8086 8087 8088; do ./stop.sh $p; done
./serve.sh test/p1 8085 ebp_prod >/dev/null; ./serve.sh test/work 8086 ebp_prod >/dev/null; ./serve.sh test/work 8087 ebp_suite >/dev/null; EXTRA_ENV="X_NOOP=1" ./serve.sh test/work 8088 ebp_suite >/dev/null
cd tests
python3 repair_tests.py pre > $L/repair_pre.log 2>&1
$M ebp_prod < /data/ebp/work/website/database/migrations/010_api_tokens.sql
python3 repair_tests.py post > $L/repair_post.log 2>&1
python3 resilience.py > $L/resilience.log 2>&1
cd /data/ebp/test/work; export DB_CLI="$M ebp_suite" MAIL_DIR=/data/ebp/test/work/storage/mail
bash tools/runtime_tests.sh http://127.0.0.1:8087 > $L/runtime.log 2>&1
bash tools/admin_runtime_tests.sh http://127.0.0.1:8087 > $L/admin.log 2>&1
python3 tools/mobile_api_tests.py http://127.0.0.1:8087 > $L/mobile.log 2>&1
python3 tools/auth_runtime_tests.py http://127.0.0.1:8088 > $L/auth.log 2>&1
for f in repair_pre repair_post resilience runtime admin mobile auth; do printf "%-12s %s\n" $f "$(grep -E 'RESULT|passed|^PASS [0-9]' $L/$f.log | tail -1)"; done
