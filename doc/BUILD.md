# Building Meshmill

This document is intended to allow re-building the annoying parts from source.

Use "npm install" to setup the javascript environment. Use "npm start" to test that Meshmill works. Use "./make-appimage.sh" to build the AppImage.

## Packaging pngcam

To update pngcam, check out the https://github.com/jes/pngcam repository, run "make" and copy the files from `pngcam/build/` into `meshmill/bin/`.

## Packaging Perl

I used perlbrew to install perl 5.34.1 to `~/perl5/perlbrew/perls/perl-5.34.1`.

## Packaging GD

Using perlbrew, I installed cpanm (`perlbrew install-cpanm`) and then installed GD in perlbrew using cpanm (`cpanm GD`).
I also needed `Class::Accessor::Classy` (`cpanm Class::Accessor::Classy`).

Then `cp -a ~/perl5/perlbrew/perls/perl-5.34.1 ~/meshmill/bin/`.
