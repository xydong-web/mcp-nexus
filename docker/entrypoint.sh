#!/bin/sh
set -eu

node -v >/dev/null

mkdir -p /data

npx prisma db push --schema packages/db/prisma/schema.prisma --skip-generate

exec node packages/bridge-server/dist/index.js

