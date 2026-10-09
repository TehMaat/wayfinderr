# MakeMKV (jlesage/makemkv) plus the Wayfinderr runner: a service that runs the
# makemkvcon jobs the Wayfinderr backend writes in the shared work folder.
# Same image, same settings and volumes as jlesage/makemkv.
# Pinned: the runner relies on the image's service layout; bump it on purpose.
# v26.09.1 is MakeMKV 1.18.4: makemkvcon 2.0.0 (v26.09.2) crashes with a
# segmentation fault (exit code 139) on unencrypted Blu-rays, folders and ISOs
# (https://github.com/flathub/com.makemkv.MakeMKV/issues/123)
ARG MAKEMKV_TAG=v26.09.1
FROM jlesage/makemkv:${MAKEMKV_TAG}

COPY rootfs/ /
