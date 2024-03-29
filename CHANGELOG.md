# Changelog

## [0.1.3] - 2023-09-30
 - Fix feed rate calculation for long rotary moves
 - Enable roughing for rotary jobs
 - Remember the "rotary" setting when a project is saved

## [0.1.2] - 2023-09-05
 - Rotary carving support (buggy, and the UI reports mm where it means
   degrees, but it is useful for some cases)

## [0.1.1] - 2022-05-02
 - Pngcam backend reimplemented in Go for more performance and easier packaging
 - Toolpath segments are sorted so that they run in a more optimal order
 - Travel moves between toolpath segments can go across part geometry when
   this is faster than a lift up to the safe Z height, a rapid, and a drop back down

## [0.1.0] - 2022-04-26
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

## [0.0.3] - 2022-04-17
 - UI glitch fixes
 - Settings window
 - Option for origin location
 - Tooltips
 - Cycle time estimation

## [0.0.2] - 2022-04-13
 - Open/Save project files
 - UI glitch fixes
 - Bundle CAM::Format::STL and libgd with pngcam to fix the undocumented dependency

## [0.0.1] - 2022-04-13
 - Initial version
