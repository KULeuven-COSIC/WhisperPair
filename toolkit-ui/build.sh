#!/bin/bash

set -e

echo "Installing toolkit-ui dependencies using pnpm"
pnpm install
echo "Building toolkit-ui"
pnpm build
