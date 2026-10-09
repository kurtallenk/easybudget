#!/bin/bash
# usage: serve.sh DIR PORT [DBNAME]  - sandbox-only dev server, local DB, shared session dir
D=$1; P=$2; DB=${3:-ebp_test}
test -f $D/config/config.local.php && { echo "REFUSING: $D/config/config.local.php present (live DB creds)"; exit 1; }
cd $D; mkdir -p storage/logs storage/mail
env DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=$DB DB_USER=ebp DB_PASSWORD=ebp SESSION_SECURE=false APP_ENV=development APP_DEBUG=false \
  APP_URL=http://127.0.0.1:$P MAIL_DRIVER=log REGISTER_MAX_PER_IP=1000 LOGIN_MAX_ATTEMPTS=1000 AUTH_EMAIL_MAX_PER_IP=100000 ${EXTRA_ENV:-AUTH_EMAIL_COOLDOWN=0 AUTH_EMAIL_MAX_PER_ADDRESS=1000} \
  nohup php -d session.save_path=/tmp/ebp_sess -d variables_order=EGPCS -S 127.0.0.1:$P -t . > /tmp/server_$P.log 2>&1 & echo $! > /tmp/server_$P.pid
sleep 1; echo "started $D on $P"
