#!/bin/sh
set -eu

# Execute uvicorn and replace the shell process with it so SIGTERM works
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
