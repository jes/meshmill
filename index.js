const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const lineReader = require('line-reader');
const { app, dialog, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const openAboutWindow = require('electron-about-window').default;

const template = [
    {
        label: 'File',
        submenu: [
            { label: 'New' },
            { label: 'Open...' },
            { label: 'Save' },
            { label: 'Save as...' },
            { role: 'quit' },
        ],
    },
    {
        label: 'Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'delete' },
            { type: 'separator' },
            { label: 'Preferences...' },
        ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help',
        submenu: [
            {
                label: 'Github project',
                click: async () => {
                    await require('electron').openExternal('https://github.com/jes/meshmill')
                }
            },

            {
                label: 'About Meshmill',
                click: async () => {
                    openAboutWindow({
                        icon_path: '/home/jes/2993.png',
                        product_name: 'Meshmill',
                        homepage: 'https://github.com/jes/meshmill',
                        bug_report_url: 'https://github.com/jes/meshmill/issues',
                        description: 'Open source 3D CAM software.',
                        copyright: 'By James Stanley <james@incoherency.co.uk>',
                        adjust_window_size: true,
                    });
                }
            }
        ],
    },
];
const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

let win;

const createWindow = () => {
  win = new BrowserWindow({
    width: 1200,
    height: 700,
    minWidth: 500,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
});

var running;

ipcMain.on('render-heightmap', (event,arg) => {
    let opts = ['--border', '0', '--width', arg.width];
    if (arg.bottom) opts.push('--bottom');

    opts.push(arg.stl);
    // TODO: write outputs to project folder; also, write to a
    // temporary file until successful, then move to the project
    // folder
    let render = spawn(path.join(__dirname,'bin/pngcam-render'), opts);
    running = render;

    render.stderr.on('data', (data) => {
        process.stderr.write(""+data);
        let match = (""+data).match(/(\d+)%/);
        if (match) {
            win.webContents.send('progress', match[1]);
        }
    });

    render.stdout.on('data', (data) => {
        process.stderr.write(""+data);
    });
    
    render.on('close', (code) => {
        if (code !== 0) {
            win.webContents.send('heightmap', {
                error: `pngcam-render exited with code ${code}`,
            });
        } else {
            win.webContents.send('heightmap', {
                file: `${arg.stl}.png`,
            });
        }
    });
});

ipcMain.on('generate-toolpath', (event,arg) => {
    let opts = [
        '--tool-shape', arg.job.tool.shape,
        '--tool-diameter', arg.job.tool.diameter,
        '--step-down', arg.job.path.stepdown,
        '--step-over', arg.job.path.stepover,
        '--step-forward', arg.job.path.stepover, // TODO: should this be configurable? always equivalent to 1 px? something else?
        '--xy-feed-rate', arg.job.controller.xyfeed,
        '--z-feed-rate', arg.job.controller.zfeed,
        '--speed', arg.job.controller.rpm,
        '--clearance', arg.job.path.clearance,
        '--rapid-clearance', arg.job.controller.safez,
        '--route', arg.job.path.direction,
        '--width', arg.width,
        '--depth', arg.depth,
        '--x-offset', arg.offset.x,
        '--y-offset', arg.offset.y,
        '--z-offset', arg.offset.z,
    ];
    if (arg.roughingonly) opts.push('--roughing-only');
    if (arg.rampentry) opts.push('--ramp-entry');
    if (arg.omittop) opts.push('--omit-top');
    if (arg.clearbottom) opts.push('--deep-black');

    opts.push(arg.heightmap);
    // TODO: write outputs to project folder; also, write to a
    // temporary file until successful, then move to the project
    // folder
    let gcodeFile = tmp.fileSync().name;
    let gcodeStream = fs.createWriteStream(gcodeFile);
    gcodeStream.on('open', function() {
        let pngcam = spawn(path.join(__dirname, 'bin/pngcam'), opts, {
            stdio: ['pipe', gcodeStream, 'pipe'], // send stdout to a file
        });
        running = pngcam;

        pngcam.stderr.on('data', (data) => {
            process.stderr.write(""+data);
            let match = (""+data).match(/(\d+)%/);
            if (match) {
                win.webContents.send('progress', match[1]);
            }
        });

        pngcam.on('close', (code) => {
            if (code !== 0) {
                win.webContents.send('toolpath', {
                    error: `pngcam exited with code ${code}`,
                });
            } else {
                win.webContents.send('toolpath', {
                    file: gcodeFile,
                });
            }
        });
    });
});

// this is a dead simple "gcode parser" that is sufficient for
// parsing pngcam outputs and nothing more
ipcMain.on('plot-toolpath', (event,arg) => {
    let path = [];
    let X = 0; let Y = 0; let Z = 0;
    path.push([X,Y,Z]);
    // TODO: distinguish G0 from G1
    lineReader.eachLine(arg.file, (line,last) => {
        let match = line.match(/^G0*[01] /i);
        if (match) {
            let xmatch = line.match(/X([0-9-.]*)\b/i);
            if (xmatch) X = parseFloat(xmatch[1]);
            let ymatch = line.match(/Y([0-9-.]*)\b/i);
            if (ymatch) Y = parseFloat(ymatch[1]);
            let zmatch = line.match(/Z([0-9-.]*)\b/i);
            if (zmatch) Z = parseFloat(zmatch[1]);
            path.push([X,Y,Z]);
        }
        if (last) win.webContents.send('toolpath-points', path);
    });
});

ipcMain.on('cancel', (event,arg) => {
    running.kill();
});

ipcMain.on('save-file', (event,arg) => {
    let dstfile = dialog.showSaveDialogSync();
    // TODO: alert on errors, feedback of success
    fs.copyFile(arg.file, dstfile, function(){});
});
