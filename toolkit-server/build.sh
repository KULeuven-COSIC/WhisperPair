#!/bin/bash

set -e

echo "Installing toolkit-server dependencies using pnpm"
pnpm install
echo "Building toolkit-server"
pnpm build
