const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const lineReader = require('line-reader');
const { app, dialog, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const tar = require('tar');
const openAboutWindow = require('electron-about-window').default;

let win;

let filename = null;

const template = [
    {
        label: 'File',
        submenu: [
            {
                label: 'New',
                click: async () => {
                    win.webContents.send('new-project');
                    filename = null;
                }
            },
            {
                label: 'Open...',
                accelerator: 'Ctrl+O',
            },
            {
                label: 'Save',
                accelerator: 'Ctrl+S',
                click: async () => {
                    let f = getFilename();
                    if (f)
                        win.webContents.send('save-project', f);
                },
             },
            {
                label: 'Save as...',
                accelerator: 'Ctrl+Shift+S',
                click: async () => {
                    let f = getNewFilename();
                    if (f)
                        win.webContents.send('save-project', f);
                },
            },
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

  win.on('close', (event) => {
    if (win) {
        event.preventDefault();
        win.webContents.send('want-close');
    }
  });
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
});

var running;

ipcMain.on('render-heightmap', (event,arg,replychan) => {
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
            win.webContents.send(replychan, {
                error: `pngcam-render exited with code ${code}`,
            });
        } else {
            win.webContents.send(replychan, {
                file: `${arg.stl}.png`,
            });
        }
    });
});

ipcMain.on('generate-toolpath', (event,arg,replychan) => {
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
                win.webContents.send(replychan, {
                    error: `pngcam exited with code ${code}`,
                });
            } else {
                win.webContents.send(replychan, {
                    file: gcodeFile,
                });
            }
        });
    });
});

// this is a dead simple "gcode parser" that is sufficient for
// parsing pngcam outputs and nothing more
ipcMain.on('plot-toolpath', (event,arg,replychan) => {
    let path = [];
    let X = 0; let Y = 0; let Z = 0;
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
        if (last) win.webContents.send(replychan, path);
    });
});

ipcMain.on('cancel', (event,arg) => {
    running.kill();
});

ipcMain.on('save-file', (event,arg) => {
    // TODO: take title, filename filter as arg
    let dstfile = dialog.showSaveDialogSync(win, {
        showOverwriteConfirmation: true,
    });
    // TODO: alert on errors, feedback of success
    if (dstfile)
        fs.copyFile(arg.file, dstfile, function(){});
});

ipcMain.on('copy-file', (event,arg,replychan) => {
    fs.copyFile(arg.src, arg.dst, 0, function(err) {
        if (err) console.log(err);
        let resp = err ? null : arg.dst;
        win.webContents.send(replychan, resp);
    });
});

ipcMain.on('write-file', (event,arg,replychan) => {
    fs.writeFile(arg.file, arg.data, (err) => {
        if (err) console.log(err);
        win.webContents.send(replychan, err);
    });
});

ipcMain.on('read-file', (event,arg,replychan) => {
    fs.readFile(arg.file, 'utf8', (err,data) => {
        if (err) console.log(err);
        win.webContents.send(replychan, {
            err: err,
            data: data,
        });
    });
});

ipcMain.on('close', (event,arg) => {
    win = null;
    app.quit();
});

ipcMain.on('confirm-dialog', (event,arg,replychan) => {
    dialog.showMessageBox({
        buttons: [arg.yes, arg.no],
        message: arg.text,
    }).then((response) => {
        win.webContents.send(replychan, response.response == 0);
    });
});

ipcMain.on('tmpdir', (event,arg,replychan) => {
    var dir = tmp.dirSync().name;
    win.webContents.send(replychan, dir);
});

ipcMain.on('tar-up', (event,arg,replychan) => {
    tar.create({
        gzip: true,
        cwd: arg.dir,
        file: arg.dest,
    }, ["."]).then(err => {
        win.webContents.send(replychan, null);
    }).catch(err => {
        console.log(err);
        win.webContents.send(replychan, err);
    });
});

function getFilename() {
    if (!filename) filename = dialog.showSaveDialogSync(win, {
        title: "Save",
        defaultPath: 'Untitled.meshmill',
        showOverwriteConfirmation: true,
        filters: [{name: "Meshmill Projects (.meshmill)", extensions: ["meshmill"]},{name: "All Files", extensions:["*"]}],
    });
    return filename;
}

function getNewFilename() {
    newfilename = dialog.showSaveDialogSync(win, {
        title: "Save",
        defaultPath: 'Untitled.meshmill',
        showOverwriteConfirmation: true,
        filters: [{name: "Meshmill Projects (.meshmill)", extensions: ["meshmill"]},{name: "All Files", extensions:["*"]}],
    });
    if (newfilename) filename = newfilename;
    return newfilename;
}
