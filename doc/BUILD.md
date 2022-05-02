# Building Meshmill

This document is intended to allow re-building the annoying parts from source.

Use "npm install" to setup the javascript environment. Use "npm start" to test that Meshmill works. Use "./make-appimage.sh" to build the AppImage.

## Packaging pngcam

To update pngcam, check out the https://github.com/jes/pngcam repository, run "make" and copy the files from `pngcam/build/` into `meshmill/bin/`.
