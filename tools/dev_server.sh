#!/usr/bin/env bash
# ===========================================================================
# Starts PHP's built-in server for local development and testing.
#
#   tools/dev_server.sh [port]
#
# Environment (all optional):
#   DB_SOCKET / DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
#   RELAX_THROTTLE=1   raises the sign-up/sign-in and auth-email limits so a
#                      test run can create several users in a row
#   MAIL_DRIVER        defaults to "log" here: emails land in storage/mail/
#
# The built-in server is single-threaded and for development only. Production
# runs behind Apache with the shipped .htaccess files.
# ===========================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8080}"

export SESSION_SECURE="${SESSION_SECURE:-false}"   # plain HTTP on loopback
export APP_ENV="${APP_ENV:-development}"
export APP_DEBUG="${APP_DEBUG:-true}"
# Emails are written to storage/mail/*.eml instead of being sent, unless a
# real SMTP server is configured (MAIL_DRIVER=smtp MAIL_HOST=...).
export MAIL_DRIVER="${MAIL_DRIVER:-log}"

if [ "${RELAX_THROTTLE:-0}" = "1" ]; then
  export REGISTER_MAX_PER_IP=1000
  export LOGIN_MAX_ATTEMPTS=1000
  export AUTH_EMAIL_MAX_PER_IP=100000
fi

mkdir -p storage/logs
echo "Budget Planner on http://127.0.0.1:$PORT  (Ctrl+C to stop)"
exec php -S "127.0.0.1:$PORT" -t .
