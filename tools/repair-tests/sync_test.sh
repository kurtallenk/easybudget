#!/bin/bash
# copy working website to an isolated test dir WITHOUT the live config
rm -rf /data/ebp/test/work && cp -a /data/ebp/work/website /data/ebp/test/work && rm -f /data/ebp/test/work/config/config.local.php && rm -rf /data/ebp/test/work/storage/logs/*.log /data/ebp/test/work/storage/mail/*.eml
