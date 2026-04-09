#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: ./update_server_url.sh <SERVER_URL>"
  exit 1
fi

echo "SERVER_URL=\"$1\"" > .env
echo "URL written. Don't forget to rebuild the UI."
