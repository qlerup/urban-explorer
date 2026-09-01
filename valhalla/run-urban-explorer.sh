#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/custom_files/valhalla.json"
MAX_RADIUS_METERS="${VALHALLA_MAX_RADIUS_METERS:-5000}"

# Let the upstream image download/reuse OSM data, update its config and build
# tiles exactly as normal, but do not start the service yet. This lets us patch
# service-level limits after valhalla.json exists and before Loki starts.
export serve_tiles="False"
/valhalla/scripts/run.sh build_tiles

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "ERROR: Valhalla config was not created at ${CONFIG_FILE}"
  exit 1
fi

if ! [[ "${MAX_RADIUS_METERS}" =~ ^[0-9]+$ ]] || [[ "${MAX_RADIUS_METERS}" -lt 1 ]]; then
  echo "ERROR: VALHALLA_MAX_RADIUS_METERS must be a positive integer"
  exit 1
fi

TMP_CONFIG="$(mktemp)"
jq --argjson radius "${MAX_RADIUS_METERS}" \
  '.service_limits.max_radius = $radius' \
  "${CONFIG_FILE}" > "${TMP_CONFIG}"

# The upstream image's default user has passwordless sudo and the persistent
# config may be owned by root after the initial build.
sudo mv "${TMP_CONFIG}" "${CONFIG_FILE}"
sudo chmod 664 "${CONFIG_FILE}"

echo "INFO: Urban Explorer Valhalla max snap radius set to ${MAX_RADIUS_METERS} meters."
echo "INFO: Starting Valhalla service."

THREADS="${server_threads:-$(nproc)}"
if [[ "$(id --user)" == "59999" ]] && [[ "$(id --group)" == "59999" ]]; then
  exec sudo -E env LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" valhalla_service "${CONFIG_FILE}" "${THREADS}"
else
  exec valhalla_service "${CONFIG_FILE}" "${THREADS}"
fi
