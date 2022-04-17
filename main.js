const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const lineReader = require('line-reader');
const { app, dialog, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const tar = require('tar');
const openAboutWindow = require('electron-about-window').default;
const rmdir = require('rimraf');

let win;
let settingswin;

let filename = null;
let tmpnames = [];

let settings = {
    imperial: false,
    workflow_hints: true,
    show_heightmap_2d: true,
    maxvel: 4000,
    maxaccel: 50,
};
let settingsfile = path.join(app.getPath('userData'), 'meshmill.json');
try {
    settings = JSON.parse(fs.readFileSync(settingsfile));
} catch(err) {
    console.log(err);
}

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
                click: async () => {
                    win.webContents.send('want-open');
                },
            },
            {
                label: 'Save',
                accelerator: 'Ctrl+S',
                click: async () => {
                    let f = getSaveFilename();
                    if (f)
                        win.webContents.send('save-project', f);
                },
             },
            {
                label: 'Save as...',
                accelerator: 'Ctrl+Shift+S',
                click: async () => {
                    let f = getNewSaveFilename();
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
            {
                label: 'Settings...',
                click: async () => {
                    settingswin = new BrowserWindow({
                        parent: win,
                        modal: true,
                        width: 300,
                        height: 300,
                        webPreferences: {
                          preload: path.join(__dirname, "preload.js"),
                        },
                    });
                    settingswin.setMenu(null);
                    settingswin.loadFile('settings.html');
                },
            }
        ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help',
        submenu: [
            {
                label: 'Github project',
                click: async () => {
                    await require('electron').shell.openExternal('https://github.com/jes/meshmill')
                }
            },

            {
                label: 'About Meshmill',
                click: async () => {
                    openAboutWindow({
                        icon_path: path.join(__dirname, 'img/logo.png'),
                        css_path: path.join(__dirname, 'css/about.css'),
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
    let opts = ['pngcam-render', '--border', '0', '--width', arg.width];
    if (arg.bottom) opts.push('--bottom');

    opts.push(arg.stl);
    // TODO: write outputs to project folder; also, write to a
    // temporary file until successful, then move to the project
    // folder
    let render = spawn(path.join(__dirname,'bin/perlrun'), opts);
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
        'pngcam',
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
        '--max-vel', settings.maxvel,
        '--max-accel', settings.maxaccel,
    ];
    if (arg.roughingonly) opts.push('--roughing-only');
    if (arg.rampentry) opts.push('--ramp-entry');
    if (arg.omittop) opts.push('--omit-top');
    if (arg.clearbottom) opts.push('--deep-black');
    if (arg.imperial) opts.push('--imperial');

    opts.push(arg.heightmap);
    // TODO: write outputs to project folder; also, write to a
    // temporary file until successful, then move to the project
    // folder
    let gcodeFile = tmp.fileSync({prefix:'meshmill', postfix:'.gcode'}).name;
    tmpnames.push(gcodeFile);
    let gcodeStream = fs.createWriteStream(gcodeFile);
    gcodeStream.on('open', function() {
        let pngcam = spawn(path.join(__dirname, 'bin/perlrun'), opts, {
            stdio: ['pipe', gcodeStream, 'pipe'], // send stdout to a file
        });
        running = pngcam;

        pngcam.stderr.on('data', (data) => {
            process.stderr.write(""+data);
            let match = (""+data).match(/(\d+)%/);
            if (match) {
                win.webContents.send('progress', match[1]);
            }

            match = (""+data).match(/Cycle time estimate: ([0-9.]+) secs/);
            if (match) {
                win.webContents.send('cycle-time', parseFloat(match[1]));
            }
        });

        pngcam.on('close', (code) => {
            gcodeStream.end(function() {
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
    fs.readFile(arg, 'utf8', (err,data) => {
        if (err) console.log(err);
        win.webContents.send(replychan, {
            err: err,
            data: data,
        });
    });
});

ipcMain.on('close', (event,arg) => {
    win = null;
    // remove temporary directories
    for (var i = 0; i < tmpnames.length; i++) {
        rmdir(tmpnames[i], (err) => {
            if (err) console.log(err);
        });
    }
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
    var dir = tmp.dirSync({prefix:'meshmill'}).name;
    tmpnames.push(dir);
    win.webContents.send(replychan, dir);
});

ipcMain.on('tar-up', (event,arg,replychan) => {
    tar.create({
        gzip: true,
        cwd: arg.dir,
        file: arg.dest,
    }, ["."]).then(_ => {
        win.webContents.send(replychan, null);
    }).catch(err => {
        console.log(err);
        win.webContents.send(replychan, err);
    });
});

ipcMain.on('untar', (event,arg,replychan) => {
    tar.extract({
        file: arg.file,
        cwd: arg.dir,
    }).then(_ => {
        win.webContents.send(replychan, null);
    }).catch(err => {
        console.log(err);
        win.webContents.send(replychan, err);
    });
});

ipcMain.on('open-project', (event,arg,replychan) => {
    let f = getOpenFilename();
    if (f)
        win.webContents.send('open-project', f);
});

ipcMain.on('get-settings', (event,arg,replychan) => {
    win.webContents.send(replychan||'set-settings', settings);
});
ipcMain.on('settings-get-settings', (event,arg,replychan) => {
    settingswin.webContents.send(replychan, settings);
});
ipcMain.on('set-settings', (event,arg,replychan) => {
    settings = arg;
    fs.writeFileSync(settingsfile, JSON.stringify(settings));
    win.webContents.send('set-settings', settings);
});

function getSaveFilename() {
    if (!filename) filename = dialog.showSaveDialogSync(win, {
        title: "Save",
        defaultPath: 'Untitled.meshmill',
        showOverwriteConfirmation: true,
        filters: [{name: "Meshmill Projects (.meshmill)", extensions: ["meshmill"]},{name: "All Files", extensions:["*"]}],
    });
    return filename;
}

function getNewSaveFilename() {
    newfilename = dialog.showSaveDialogSync(win, {
        title: "Save",
        defaultPath: 'Untitled.meshmill',
        showOverwriteConfirmation: true,
        filters: [{name: "Meshmill Projects (.meshmill)", extensions: ["meshmill"]},{name: "All Files", extensions:["*"]}],
    });
    if (newfilename) filename = newfilename;
    return newfilename;
}

function getOpenFilename() {
    newfilename = dialog.showOpenDialogSync(win, {
        title: "Open",
        showOverwriteConfirmation: true,
        filters: [{name: "Meshmill Projects (.meshmill)", extensions: ["meshmill"]},{name: "All Files", extensions:["*"]}],
    });
    if (newfilename) {
        filename = newfilename[0];
        return filename;
    }
    return newfilename;
}
