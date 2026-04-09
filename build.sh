#!/bin/bash

set -e

# backend
cd toolkit-server
bash build.sh

cd ..

# frontend
cd toolkit-ui
bash build.sh

cd ..

echo "Installed dependencies and built toolkit-server and toolkit-ui"