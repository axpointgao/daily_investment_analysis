#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-/app/.env}"
POLL_INTERVAL="${SCHEDULE_SUPERVISOR_POLL_INTERVAL:-10}"

child_pid=""
last_signature=""

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

read_env_value() {
  key="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  grep -E "^[[:space:]]*${key}=" "$ENV_FILE" \
    | tail -n 1 \
    | cut -d '=' -f 2- \
    | sed -e 's/\r$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" \
    || true
}

schedule_enabled() {
  value="$(read_env_value SCHEDULE_ENABLED | tr '[:upper:]' '[:lower:]' | xargs)"
  [ "$value" = "true" ]
}

schedule_signature() {
  if [ ! -f "$ENV_FILE" ]; then
    printf 'missing-env'
    return
  fi
  grep -E '^[[:space:]]*(SCHEDULE_ENABLED|SCHEDULE_TIME|SCHEDULE_RUN_IMMEDIATELY|RUN_IMMEDIATELY)=' "$ENV_FILE" \
    | sed -e 's/\r$//' \
    || true
}

stop_child() {
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    log "Stopping scheduler process pid=${child_pid}"
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  child_pid=""
}

start_child() {
  args="--schedule"
  run_immediately="$(read_env_value SCHEDULE_RUN_IMMEDIATELY | tr '[:upper:]' '[:lower:]' | xargs)"
  if [ "$run_immediately" != "true" ]; then
    args="${args} --no-run-immediately"
  fi
  log "Starting scheduler process: python main.py ${args}"
  # shellcheck disable=SC2086
  python main.py ${args} &
  child_pid="$!"
}

cleanup() {
  stop_child
}

trap cleanup INT TERM

log "Analyzer supervisor started; env_file=${ENV_FILE}, poll_interval=${POLL_INTERVAL}s"

while true; do
  signature="$(schedule_signature)"

  if [ "$signature" != "$last_signature" ]; then
    last_signature="$signature"
    if schedule_enabled; then
      stop_child
      start_child
    else
      stop_child
      log "SCHEDULE_ENABLED is not true; scheduler is idle"
    fi
  fi

  if [ -n "$child_pid" ] && ! kill -0 "$child_pid" 2>/dev/null; then
    wait "$child_pid" 2>/dev/null || true
    child_pid=""
    if schedule_enabled; then
      log "Scheduler process exited; restarting because SCHEDULE_ENABLED=true"
      start_child
    fi
  fi

  sleep "$POLL_INTERVAL"
done
