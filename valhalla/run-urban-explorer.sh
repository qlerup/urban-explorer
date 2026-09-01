#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/custom_files/valhalla.json"
MAX_RADIUS_METERS="${VALHALLA_MAX_RADIUS_METERS:-5000}"
GRAPH_VERSION="${URBAN_EXPLORER_VALHALLA_GRAPH_VERSION:-2}"
GRAPH_VERSION_FILE="/custom_files/.urban_explorer_graph_version"

if ! [[ "${MAX_RADIUS_METERS}" =~ ^[0-9]+$ ]] || [[ "${MAX_RADIUS_METERS}" -lt 1 ]]; then
  echo "ERROR: VALHALLA_MAX_RADIUS_METERS must be a positive integer"
  exit 1
fi

# A previous/incomplete tile build can look healthy to valhalla_service while
# every route still fails with "No suitable edges near location". The upstream
# image normally reuses any existing tile archive, so a broken graph would then
# survive every container restart. Use our own graph-version marker to force a
# clean rebuild exactly once when Urban Explorer changes the graph setup.
CURRENT_GRAPH_VERSION=""
if [[ -f "${GRAPH_VERSION_FILE}" ]]; then
  CURRENT_GRAPH_VERSION="$(cat "${GRAPH_VERSION_FILE}" 2>/dev/null || true)"
fi

if [[ "${CURRENT_GRAPH_VERSION}" != "${GRAPH_VERSION}" ]]; then
  echo "INFO: Urban Explorer Valhalla graph version ${CURRENT_GRAPH_VERSION:-none} -> ${GRAPH_VERSION}."
  echo "INFO: Removing generated graph files for a one-time clean rebuild."

  # Keep the downloaded *.osm.pbf so the rebuild does not need to download
  # Denmark again. Remove only generated graph/config-support artifacts.
  sudo rm -rf \
    /custom_files/valhalla_tiles \
    /custom_files/valhalla_tiles.tar \
    /custom_files/admin_data \
    /custom_files/timezone_data \
    /custom_files/traffic.tar \
    /custom_files/file_hashes.txt

  # Do not allow the upstream image to skip the PBF during this clean rebuild.
  export use_tiles_ignore_pbf="False"
  export force_rebuild="False"
  export build_tar="Force"
else
  echo "INFO: Urban Explorer Valhalla graph version ${GRAPH_VERSION} already built; reusing graph."
fi

# Let the upstream image download/reuse OSM data, update its config and build
# tiles exactly as normal, but do not start the service yet. This lets us patch
# service-level limits after valhalla.json exists and before Loki starts.
export serve_tiles="False"
/valhalla/scripts/run.sh build_tiles

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "ERROR: Valhalla config was not created at ${CONFIG_FILE}"
  exit 1
fi

# Only mark the graph version after the upstream build completed successfully.
if [[ "${CURRENT_GRAPH_VERSION}" != "${GRAPH_VERSION}" ]]; then
  echo "${GRAPH_VERSION}" | sudo tee "${GRAPH_VERSION_FILE}" >/dev/null
  sudo chmod 664 "${GRAPH_VERSION_FILE}"
  echo "INFO: Clean Valhalla graph rebuild completed; graph version ${GRAPH_VERSION} recorded."
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
