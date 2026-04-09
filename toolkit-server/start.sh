#!/bin/bash

echo "Starting Server using sudo..."

while true; do
    # Running the node process
    sudo node dist/index.js

    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        break
    fi
    
    echo "Server crashed or stopped. Restarting in 1 second..."
    sleep 1
done

