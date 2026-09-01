FROM ghcr.io/gis-ops/docker-valhalla/valhalla:latest

USER root
COPY run-urban-explorer.sh /valhalla/scripts/run-urban-explorer.sh
RUN chmod +x /valhalla/scripts/run-urban-explorer.sh
USER valhalla

ENTRYPOINT ["/valhalla/scripts/run-urban-explorer.sh"]
CMD ["build_tiles"]
