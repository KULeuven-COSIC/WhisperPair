

#!/bin/bash

set -e

echo "Starting UI and Server..."
echo "(Note: the server only works on Linux hosts with BlueZ installed.)"

# 1. Define a cleanup function to kill background processes on exit
cleanup() {
    echo ""
    echo "Stopping UI and server..."
    # 'jobs -p' gets the process IDs of the background jobs started by this script
    kill $(jobs -p)
    echo "Stopped"
    exit
}

trap cleanup SIGINT

bash start_server.sh &
bash start_ui.sh &

wait

