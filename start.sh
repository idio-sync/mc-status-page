#!/bin/sh
# start.sh

# Start Node.js backend in the background
node server.js &

# Start nginx in the foreground
nginx -g 'daemon off;'
