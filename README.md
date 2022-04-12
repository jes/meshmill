# Meshmill

![Screenshot](img/screenshot.png)

Meshmill is open source 3D CAM software.

*** This is not even beta-quality software. Use it at your own peril. ***

It aims to focus on:

 * ease of installation
 * ease of use

At the expense of:

 * power
 * performance
 * high-quality toolpaths

I created Meshmill because I was frustrated with how difficult it was to get other open source
3D CAM software to work. Maybe once we have ease of installation and ease of use sorted, we can
address the rest.

## Important stuff please read

* When a heightmap is generated from a file called `/foo/bar.stl`, it will be written to `/foo/bar.stl.png`, potentially
polluting your working directories. Eventually this will be fixed. In particular, note that if `/foo/bar.stl.png` is not
writable it won't work.

* It has lots of bugs and UI glitches. I know of many of them, but if you spot one and you want to help out, please
create a Github Issue, or send me an email if you're not on Github: james@incoherency.co.uk.

* Be careful with the generated G-code. Before running it, check that it's not going to crash your machine, break your tool, or
do anything else stupid. In particular, check the generated G-code in another application to satisfy yourself that the
paths are something close to what Meshmill rendered.

* If you use it to create some parts, please share pictures of your CAD and your final result :)

## How to use it

1. Download a release from the Releases page.

2. `chmod +x meshmill-0.0.1.AppImage`

3. `./meshmill-0.0.1.AppImage`

4. Load your STL file in the "MODEL" tab.

5. Render the heightmap. You'll see that the model turns from your smooth triangle mesh into the blocky pixelated heightmap.
This is expected. If you reduce the "resolution" value you'll get a higher-quality heightmap, at the expense of CPU time.
You need to judge for yourself what level of precision is required for your particular part with your particular machine
and cutting tools.

6. Create a job with the "+ ADD JOB" button.

7. Set your cutting parameters and click "Generate toolpath". Once it is generated it will be displayed on
top of the model in purple.

**Note** that if you now edit the parameters and generate another toolpath, the
first one will still be displayed. This is a known bug, ignore it for now. If you want to clear out the
toolpaths, go to the "MODEL" tab and re-render the heightmap.

8. Once you're happy with how your toolpath looks, use the "Save G-code" button to save it somewhere.

## Contact me

Meshmill is created by James Stanley. You can email me at james@incoherency.co.uk or read my blog at
https://incoherency.co.uk/
