# MakeMKV (jlesage/makemkv) plus the Wayfinderr runner: a service that runs the
# makemkvcon jobs the Wayfinderr backend writes in the shared work folder.
# Same image, same settings and volumes as jlesage/makemkv.
# Pinned: the runner relies on the image's service layout; bump it on purpose
ARG MAKEMKV_TAG=v26.09.2
FROM jlesage/makemkv:${MAKEMKV_TAG}

COPY rootfs/ /
