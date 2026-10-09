#!/bin/bash
P=$1; test -f /tmp/server_$P.pid && kill $(cat /tmp/server_$P.pid) 2>/dev/null; rm -f /tmp/server_$P.pid; sleep 0.5
