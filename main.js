const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const lineReader = require('line-reader');
const { app, dialog, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const tar = require('tar');
const openAboutWindow = require('electron-about-window').default;
const rmdir = require('rimraf');

app.disableHardwareAcceleration();



const MESSAGES = require('./js/i18n-data.js');
let lang = 'ru';
function t(key) {
    const args = Array.prototype.slice.call(arguments, 1);
    const str = (MESSAGES[lang] && MESSAGES[lang][key]) || (MESSAGES.en && MESSAGES.en[key]) || key;
    return str.replace(/\{(\d+)\}/g, (match, idx) => args[idx] !== undefined ? args[idx] : match);
}

let win;
let settingswin;

let launchFile = process.argv.slice(1).find(a => !a.startsWith('-') && (a.toLowerCase().endsWith('.stl') || a.toLowerCase().endsWith('.meshmill')));
let filename = null;
let tmpnames = [];

let settings = {
    lang: 'ru',
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
lang = settings.lang || 'ru';
app.commandLine.appendSwitch('lang', lang);

function buildTemplate() {
    return [
        {
            label: t('menu_file'),
            submenu: [
                {
                    label: t('menu_new'),
                    click: async () => {
                        win.webContents.send('new-project');
                        setFilename(null);
                    }
                },
                {
                    label: t('menu_open'),
                    accelerator: 'Ctrl+O',
                    click: async () => {
                        win.webContents.send('want-open');
                    },
                },
                {
                    label: t('menu_save'),
                    accelerator: 'Ctrl+S',
                    click: async () => {
                        let f = getSaveFilename();
                        if (f)
                            win.webContents.send('save-project', f);
                    },
                },
                {
                    label: t('menu_save_as'),
                    accelerator: 'Ctrl+Shift+S',
                    click: async () => {
                        let f = getNewSaveFilename();
                        if (f)
                            win.webContents.send('save-project', f);
                    },
                },
                { role: 'quit', label: t('menu_quit') },
            ],
        },
        {
            label: t('menu_edit'),
            submenu: [
                { role: 'undo', label: t('menu_undo') },
                { role: 'redo', label: t('menu_redo') },
                { type: 'separator' },
                { role: 'cut', label: t('menu_cut') },
                { role: 'copy', label: t('menu_copy') },
                { role: 'paste', label: t('menu_paste') },
                { role: 'delete', label: t('menu_delete') },
                { type: 'separator' },
                {
                    label: t('menu_settings'),
                    click: async () => {
                        settingswin = new BrowserWindow({
                            parent: win,
                            modal: true,
                            width: 420,
                            height: 460,
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
        {
            label: t('menu_view'),
            submenu: [
                { role: 'reload', label: t('menu_reload') },
                { role: 'forceReload', label: t('menu_force_reload') },
                { role: 'toggleDevTools', label: t('menu_devtools') },
                { type: 'separator' },
                { role: 'resetZoom', label: t('menu_actual_size') },
                { role: 'zoomIn', label: t('menu_zoom_in') },
                { role: 'zoomOut', label: t('menu_zoom_out') },
                { type: 'separator' },
                { role: 'togglefullscreen', label: t('menu_fullscreen') },
            ],
        },
        {
            label: t('menu_tools'),
            submenu: [
                {
                    label: t('menu_reprocess_all'),
                    click: async () => {
                        win.webContents.send('reprocess-all');
                    },
                },
                {
                    label: t('menu_reprocess_dirty'),
                    click: async () => {
                        win.webContents.send('reprocess-dirty');
                    },
                },
            ],
        },
        {
            label: t('menu_window'),
            submenu: [
                { role: 'minimize', label: t('menu_minimize') },
                { role: 'zoom', label: t('menu_zoom') },
                { role: 'close', label: t('menu_close') },
            ],
        },
        {
            label: t('menu_help'),
            submenu: [
                {
                    label: t('menu_github'),
                    click: async () => {
                        await require('electron').shell.openExternal('https://github.com/jes/meshmill')
                    }
                },
                {
                    label: t('menu_about'),
                    click: async () => {
                        openAboutWindow({
                            icon_path: path.join(__dirname, 'img/logo.png'),
                            css_path: path.join(__dirname, 'css/about.css'),
                            product_name: 'Meshmill',
                            homepage: 'https://github.com/jes/meshmill',
                            bug_report_url: 'https://github.com/jes/meshmill/issues',
                            description: t('about_description'),
                            copyright: t('about_copyright'),
                            adjust_window_size: true,
                        });
                    }
                }
            ],
        },
    ];
}

function rebuildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}
rebuildMenu();

const createWindow = () => {
  win = new BrowserWindow({
    title: "Meshmill",
    width: 1200,
    height: 700,
    minWidth: 500,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "img/icon.png"),
  })

  win.loadFile('index.html')

  if (launchFile) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('open-project', launchFile);
    });
  }

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
    let opts = ['--width', arg.width, '--height', arg.height, '--rgb'];
    if (arg.bottom) opts.push('--bottom');
    if (arg.rotary) opts.push('--rotary');

    opts.push(arg.stl);
    // TODO: write to a temporary file until successful, then move to the
    // project folder
    console.log(opts);
    let render = spawn(path.join(__dirname,'bin/pngcam-go-render'), opts);
    running = render;

    let lastRenderPct = -1;
    let lastRenderStage = null;
    let lastRenderTime = 0;
    render.stderr.on('data', (data) => {
        process.stderr.write(""+data);
        let text = ""+data;
        let matches = [...text.matchAll(/([A-Za-z][A-Za-z ]*):\s*(\d+)%/g)];
        if (matches.length) {
            let m = matches[matches.length-1];
            let stage = m[1].trim();
            let pct = m[2];
            let now = Date.now();
            if (stage !== lastRenderStage || pct !== lastRenderPct || now - lastRenderTime > 200) {
                lastRenderStage = stage;
                lastRenderPct = pct;
                lastRenderTime = now;
                win.webContents.send('progress', { stage: stage, pct: pct });
            }
        }
    });

    render.stdout.on('data', (data) => {
        process.stderr.write(""+data);
    });
    
    render.on('close', (code) => {
        console.log("RENDER_CLOSE", code);
        if (code == null) {
            win.webContents.send(replychan, {
                file: null,
            });
        } else if (code !== 0) {
            win.webContents.send(replychan, {
                error: t('err_pngcam_render', code),
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
        '--xy-feed-rate', arg.job.controller.xyfeed,
        '--z-feed-rate', arg.job.controller.zfeed,
        '--speed', arg.job.controller.rpm,
        '--clearance', arg.job.path.clearance,
        '--rapid-clearance', arg.job.controller.safez,
        '--route', arg.job.path.direction,
        '--width', arg.width,
        '--height', arg.height,
        '--depth', arg.depth,
        '--x-offset', arg.offset.x,
        '--y-offset', arg.offset.y,
        '--z-offset', arg.offset.z,
        '--max-vel', settings.maxvel,
        '--max-accel', settings.maxaccel,
        '--write-stock', arg.write_stock,
        '--rgb',
    ];
    if (arg.job.path.roughingonly) opts.push('--roughing-only');
    if (arg.job.path.rampentry) opts.push('--ramp-entry');
    if (arg.job.path.omittop) opts.push('--omit-top');
    if (arg.job.path.omitbottom) opts.push('--omit-bottom');
    if (arg.job.path.clearbottom) opts.push('--deep-black');
    if (arg.job.path.clearedges) opts.push('--beyond-edges');
    if (arg.imperial) opts.push('--imperial');
    if (arg.rotary) opts.push('--rotary');
    if (arg.read_stock) {
        opts.push('--read-stock');
        opts.push(arg.read_stock);
    }

    opts.push(arg.heightmap);
    // TODO: write to a temporary file until successful, then move to the
    // project folder
    let gcodeFile = arg.gcodepath;
    let gcodeStream = fs.createWriteStream(gcodeFile);
    gcodeStream.on('open', function() {
        console.log(opts);
        let pngcam = spawn(path.join(__dirname, 'bin/pngcam-go'), opts, {
            stdio: ['pipe', gcodeStream, 'pipe'], // send stdout to a file
        });
        running = pngcam;

        let cycletime = null;

        let lastStage = null;
        let lastPct = -1;
        let lastTime = 0;
        pngcam.stderr.on('data', (data) => {
            process.stderr.write(""+data);
            let text = ""+data;
            let matches = [...text.matchAll(/([A-Za-z][A-Za-z ]*):\s*(\d+)%/g)];
            if (matches.length) {
                let m = matches[matches.length-1];
                let stage = m[1].trim();
                let pct = m[2];
                let now = Date.now();
                if (stage !== lastStage || pct !== lastPct || now - lastTime > 200) {
                    lastStage = stage;
                    lastPct = pct;
                    lastTime = now;
                    win.webContents.send('progress', { stage: stage, pct: pct });
                }
            }

            let match = text.match(/Cycle time estimate: ([0-9.]+) secs/);
            if (match) {
                cycletime = parseFloat(match[1]);
            }
        });

        pngcam.on('close', (code) => {
            gcodeStream.end(function() {
                if (code == null) {
                    win.webContents.send(replychan, {
                        file: null,
                    });
                } else if (code !== 0) {
                    win.webContents.send(replychan, {
                        error: t('err_pngcam', code),
                    });
                } else {
                    win.webContents.send(replychan, {
                        file: gcodeFile,
                        heightmap_file: arg.write_stock,
                        cycletime: cycletime,
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
    let X = 0; let Y = 0; let Z = 0; let A = 0;
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
            let amatch = line.match(/A([0-9-.]*)\b/i);
            if (amatch) A = parseFloat(amatch[1]);
            let isCut = /^G0*1 /i.test(line) ? 1 : 0;
            path.push([X,Y,Z,A,isCut]);
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
        title: t('dialog_save'),
        defaultPath: 'Untitled.gcode',
        filters: [{name: t('filter_gcode'), extensions: ["gcode","ngc"]},{name: t('filter_all'), extensions:["*"]}],
        properties: ["showOverwriteConfirmation"],
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

ipcMain.on('read-file-binary', (event,arg,replychan) => {
    fs.readFile(arg, (err,data) => {
        if (err) console.log(err);
        win.webContents.send(replychan, {
            err: err,
            data: data,
        });
    });
});

ipcMain.on('write-file-binary', (event,arg,replychan) => {
    fs.writeFile(arg.file, Buffer.from(arg.data), (err) => {
        if (err) console.log(err);
        win.webContents.send(replychan, err);
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
    dialog.showMessageBox(win, {
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
    lang = settings.lang || 'ru';
    fs.writeFileSync(settingsfile, JSON.stringify(settings));
    rebuildMenu();
    win.webContents.send('set-settings', settings);
});

function setFilename(f) {
    filename = f;
    if (f)
        win.setTitle(path.parse(f).base + " - Meshmill");
    else
        win.setTitle("Meshmill");
}

function getSaveFilename() {
    if (!filename) filename = dialog.showSaveDialogSync(win, {
        title: t('dialog_save'),
        defaultPath: 'Untitled.meshmill',
        filters: [{name: t('filter_project'), extensions: ["meshmill"]},{name: t('filter_all'), extensions:["*"]}],
        properties: ["showOverwriteConfirmation"],
    });
    setFilename(filename);
    return filename;
}

function getNewSaveFilename() {
    newfilename = dialog.showSaveDialogSync(win, {
        title: t('dialog_save'),
        defaultPath: 'Untitled.meshmill',
        filters: [{name: t('filter_project'), extensions: ["meshmill"]},{name: t('filter_all'), extensions:["*"]}],
        properties: ["showOverwriteConfirmation"],
    });
    if (newfilename) setFilename(newfilename);
    return newfilename;
}

function getOpenFilename() {
    newfilename = dialog.showOpenDialogSync(win, {
        title: t('dialog_open'),
        filters: [{name: t('filter_project'), extensions: ["meshmill"]},{name: t('filter_all'), extensions:["*"]}],
    });
    if (newfilename) {
        setFilename(newfilename[0]);
        return filename;
    }
    return newfilename;
}
