# Changelog

## [0.1.0] - 2021-04-26
 - Package GD and Perl in the AppImage so that pngcam works on more systems
 - Check for illegal inputs (zero, negative) and either warn or reject them
 - Various UI glitch fixes and improvements
 - Diagrams in tooltips
 - Internally plot intermediate heightmaps between jobs so that roughing isn't repeated
 - Ramp entry
 - Omit top
 - Cut beyond edges
 - Fix memory leak
 - Make step forward an option instead of copying it from step over
 - 24-bit depth on heightmaps instead of 8-bit

## [0.0.3] - 2021-04-17
 - UI glitch fixes
 - Settings window
 - Option for origin location
 - Tooltips
 - Cycle time estimation

## [0.0.2] - 2021-04-13
 - Open/Save project files
 - UI glitch fixes
 - Bundle CAM::Format::STL and libgd with pngcam to fix the undocumented dependency

## [0.0.1] - 2021-04-13
 - Initial version
