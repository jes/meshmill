const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const lineReader = require('line-reader');
const { app, dialog, BrowserWindow, ipcMain, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const tar = require('tar');
const openAboutWindow = require('electron-about-window').default;
const rmdir = require('rimraf');

// Hardware GPU acceleration enabled for 3D preview / simulation.
// (Previously disabled due to software-GL quirks on some hosts.)

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
    settings = Object.assign(settings, JSON.parse(fs.readFileSync(settingsfile)));
} catch(err) {
    // First run or unreadable settings — keep defaults.
    if (err && err.code !== 'ENOENT')
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
    runPngcamToGcode(opts, arg.gcodepath, function(err, result) {
        if (err) {
            win.webContents.send(replychan, { error: err });
            return;
        }
        if (!result || !result.file) {
            win.webContents.send(replychan, { file: null });
            return;
        }
        win.webContents.send(replychan, {
            file: result.file,
            heightmap_file: arg.write_stock,
            cycletime: result.cycletime,
        });
    });
});

/** Run pngcam-go, buffering stdout fully before writing the G-code file.
 *  Avoids truncated toolpaths from WriteStream races on process close. */
function runPngcamToGcode(opts, gcodeFile, cb) {
    let pngcamBin = path.join(__dirname, 'bin/pngcam-go');
    if (!fs.existsSync(pngcamBin))
        pngcamBin = path.join(process.resourcesPath || __dirname, 'app/bin/pngcam-go');
    console.log(opts);
    let pngcam = spawn(pngcamBin, opts.map(String), {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    running = pngcam;
    let chunks = [];
    let cycletime = null;
    let lastStage = null, lastPct = -1, lastTime = 0;
    let settled = false;
    let finish = (err, result) => {
        if (settled) return;
        settled = true;
        cb(err, result);
    };
    pngcam.stdout.on('data', (data) => { chunks.push(Buffer.from(data)); });
    pngcam.stderr.on('data', (data) => {
        process.stderr.write('' + data);
        let text = '' + data;
        let matches = [...text.matchAll(/([A-Za-z][A-Za-z ]*):\s*(\d+)%/g)];
        if (matches.length) {
            let m = matches[matches.length - 1];
            let stage = m[1].trim();
            let pct = m[2];
            let now = Date.now();
            if (stage !== lastStage || pct !== lastPct || now - lastTime > 200) {
                lastStage = stage; lastPct = pct; lastTime = now;
                if (win) win.webContents.send('progress', { stage: stage, pct: pct });
            }
        }
        let match = text.match(/Cycle time estimate: ([0-9.]+) secs/);
        if (match) cycletime = parseFloat(match[1]);
    });
    pngcam.on('error', (err) => finish(String(err)));
    pngcam.on('close', (code) => {
        try {
            fs.writeFileSync(gcodeFile, Buffer.concat(chunks));
        } catch (e) {
            finish(String(e));
            return;
        }
        if (code == null) finish(null, { file: null });
        else if (code !== 0) finish(t('err_pngcam', code));
        else finish(null, { file: gcodeFile, cycletime: cycletime });
    });
}

// this is a dead simple "gcode parser" that is sufficient for
// parsing pngcam outputs and nothing more
ipcMain.on('plot-toolpath', (event,arg,replychan) => {
    let path = [];
    let X = 0; let Y = 0; let Z = 0; let A = 0;
    // TODO: distinguish G0 from G1
    if (!arg.file || !fs.existsSync(arg.file)) {
        win.webContents.send(replychan, path);
        return;
    }
    // pngcam emits almost everything as G1; rapids are distinguished by high F
    // (typically F10000) vs cutting feeds (xyfeed / zfeed).
    let rapidFeed = (settings && settings.maxvel) ? settings.maxvel : 4000;
    if (rapidFeed < 3000) rapidFeed = 10000;
    let lastF = rapidFeed;
    lineReader.eachLine(arg.file, (line,last) => {
        // Accept "G1 X.." and "G01X.." (with or without space)
        let match = line.match(/^G0*([01])(?!\d)/i);
        if (match) {
            let xmatch = line.match(/X([+\-0-9.]+)/i);
            if (xmatch) X = parseFloat(xmatch[1]);
            let ymatch = line.match(/Y([+\-0-9.]+)/i);
            if (ymatch) Y = parseFloat(ymatch[1]);
            let zmatch = line.match(/Z([+\-0-9.]+)/i);
            if (zmatch) Z = parseFloat(zmatch[1]);
            let amatch = line.match(/A([+\-0-9.]+)/i);
            if (amatch) A = parseFloat(amatch[1]);
            let fmatch = line.match(/\bF([+\-0-9.]+)/i);
            if (fmatch) lastF = parseFloat(fmatch[1]);
            let code = match[1];
            // G0 always travel; G1 is cut only when feed is clearly below rapid
            let isCut = 0;
            if (code === '1' && lastF < rapidFeed * 0.9 && lastF < 8000)
                isCut = 1;
            path.push([X,Y,Z,A,isCut]);
        }
        if (last) win.webContents.send(replychan, path);
    });
});

ipcMain.on('cancel', (event,arg) => {
    if (running) {
        try { running.kill(); } catch (err) { console.log(err); }
        running = undefined;
    }
});

ipcMain.on('save-file', (event,arg) => {
    // TODO: take title, filename filter as arg
    let dstfile = dialog.showSaveDialogSync(win, {
        title: t('dialog_save'),
        defaultPath: 'Untitled.gcode',
        filters: [{name: t('filter_gcode'), extensions: ["gcode","ngc"]},{name: t('filter_all'), extensions:["*"]}],
        properties: ["showOverwriteConfirmation"],
    });
    if (dstfile) {
        fs.copyFile(arg.file, dstfile, function(err) {
            if (err) {
                console.log(err);
                dialog.showErrorBox(t('dialog_save'), String(err));
            }
        });
    }
});

ipcMain.on('copy-file', (event,arg,replychan) => {
    fs.copyFile(arg.src, arg.dst, 0, function(err) {
        if (err) console.log(err);
        let resp = err ? null : arg.dst;
        win.webContents.send(replychan, resp);
    });
});

/** Fast STL header/size probe (no full mesh load into RAM). */
ipcMain.on('stl-info', (event, arg, replychan) => {
    try {
        let file = (arg && arg.file) ? arg.file : arg;
        if (!file || !fs.existsSync(file)) {
            win.webContents.send(replychan, { error: 'File not found' });
            return;
        }
        let st = fs.statSync(file);
        let triangles = null;
        let binary = false;
        let fd = fs.openSync(file, 'r');
        try {
            let hdr = Buffer.alloc(84);
            fs.readSync(fd, hdr, 0, 84, 0);
            let n = hdr.readUInt32LE(80);
            // Heuristic: binary STL size matches 84 + n*50
            if (n > 0 && Math.abs(st.size - (84 + n * 50)) <= 100) {
                binary = true;
                triangles = n;
            }
        } finally {
            fs.closeSync(fd);
        }
        win.webContents.send(replychan, {
            file: file,
            size: st.size,
            triangles: triangles,
            binary: binary,
        });
    } catch (e) {
        win.webContents.send(replychan, { error: String(e) });
    }
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
    let buf;
    try {
        if (typeof arg.data === 'string')
            buf = Buffer.from(arg.data, arg.encoding === 'base64' ? 'base64' : 'binary');
        else if (Buffer.isBuffer(arg.data))
            buf = arg.data;
        else if (arg.data && arg.data.type === 'Buffer' && Array.isArray(arg.data.data))
            buf = Buffer.from(arg.data.data);
        else
            buf = Buffer.from(arg.data);
    } catch (e) {
        win.webContents.send(replychan, String(e));
        return;
    }
    fs.writeFile(arg.file, buf, (err) => {
        if (err) console.log(err);
        win.webContents.send(replychan, err);
    });
});

/** Sample 24-bit height from BGRA bitmap (Electron nativeImage.toBitmap). */
function sampleHeightBGRA(bitmap, w, h, fx, fy) {
    if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1)
        return 0;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    let x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    let tx = fx - x0, ty = fy - y0;
    function at(x, y) {
        let i = (y * w + x) * 4;
        // BGRA → height from R,G,B
        return bitmap[i + 2] * 65536 + bitmap[i + 1] * 256 + bitmap[i];
    }
    let h00 = at(x0, y0), h10 = at(x1, y0), h01 = at(x0, y1), h11 = at(x1, y1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}

function encodeHeightBGRA(hv, out, i) {
    hv = Math.max(0, Math.min(16777215, Math.round(hv)));
    out[i] = hv & 255;            // B
    out[i + 1] = (hv >> 8) & 255; // G
    out[i + 2] = (hv >> 16) & 255;// R
    out[i + 3] = 255;             // A
}

function pointInBoundsMain(x, y, b, eps) {
    eps = eps || 1e-6;
    return x >= b.xmin - eps && x <= b.xmax + eps && y >= b.ymin - eps && y <= b.ymax + eps;
}

function plainXYZ(v) {
    if (!v) return { x: 0, y: 0, z: 0 };
    return {
        x: Number(v.x) || 0,
        y: Number(v.y) || 0,
        z: Number(v.z) || 0,
    };
}

function loadNativeImage(file) {
    if (!file || !fs.existsSync(file))
        throw new Error('Heightmap not found: ' + file);
    // createFromBuffer is more reliable than createFromPath for temp PNGs
    let buf = fs.readFileSync(file);
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty())
        img = nativeImage.createFromPath(file);
    if (img.isEmpty())
        throw new Error('Failed to decode heightmap: ' + file);
    return img;
}

function angledLog(dir, msg, obj) {
    try {
        let line = new Date().toISOString() + ' ' + msg +
            (obj !== undefined ? ' ' + JSON.stringify(obj) : '') + '\n';
        if (dir) fs.appendFileSync(path.join(dir, 'angled-debug.log'), line);
        console.log('angled:', msg, obj !== undefined ? obj : '');
    } catch (e) { /* ignore */ }
}

/** Rotate heightmap content by -angleDeg; returns meta. Throws on failure. */
function rotateHeightmapSync(arg) {
    if (win) win.webContents.send('progress', { stage: 'Rotate heightmap', pct: 0 });

    let img = loadNativeImage(arg.srcFile);
    let size = img.getSize();
    let w = size.width, h = size.height;
    let bitmap = img.toBitmap();

    let origin = plainXYZ(arg.origin);
    let meshMin = plainXYZ(arg.mesh && arg.mesh.min);
    let meshMax = plainXYZ(arg.mesh && arg.mesh.max);
    let angleDeg = parseFloat(arg.angleDeg) || 0;
    let resolution = Math.max(parseFloat(arg.resolution) || 0.5, 0.05);

    let xmin = meshMin.x - origin.x;
    let xmax = meshMax.x - origin.x;
    let ymin = meshMin.y - origin.y;
    let ymax = meshMax.y - origin.y;
    if (!(xmax > xmin) || !(ymax > ymin))
        throw new Error('Invalid mesh bounds for angled heightmap');
    let cx = (xmin + xmax) / 2;
    let cy = (ymin + ymax) / 2;
    let mask = arg.stockBounds || { xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax };

    let rad = -angleDeg * Math.PI / 180;
    let cos = Math.cos(rad), sin = Math.sin(rad);
    let invcos = Math.cos(-rad), invsin = Math.sin(-rad);

    let corners = [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]];
    let xs = [], ys = [];
    for (let i = 0; i < 4; i++) {
        let dx = corners[i][0] - cx, dy = corners[i][1] - cy;
        xs.push(cx + dx * cos - dy * sin);
        ys.push(cy + dx * sin + dy * cos);
    }
    let pad = Math.max(resolution, 0.1) * 2;
    let nminx = Math.min.apply(null, xs) - pad;
    let nmaxx = Math.max.apply(null, xs) + pad;
    let nminy = Math.min.apply(null, ys) - pad;
    let nmaxy = Math.max.apply(null, ys) + pad;

    let nw = Math.max(2, Math.ceil((nmaxx - nminx) / resolution) + 1);
    let nh = Math.max(2, Math.ceil((nmaxy - nminy) / resolution) + 1);
    let maxDim = 2500;
    let res = resolution;
    if (nw > maxDim || nh > maxDim) {
        let scale = Math.max(nw / maxDim, nh / maxDim);
        res *= scale;
        nw = Math.max(2, Math.ceil((nmaxx - nminx) / res) + 1);
        nh = Math.max(2, Math.ceil((nmaxy - nminy) / res) + 1);
    }

    let outBuf = Buffer.alloc(nw * nh * 4);
    let ow = xmax - xmin, oh = ymax - ymin;
    let soft = Math.max(res, 0.5);
    let lastPct = -1;

    for (let j = 0; j < nh; j++) {
        let yworld = nmaxy - (nh <= 1 ? 0 : j * (nmaxy - nminy) / (nh - 1));
        for (let i = 0; i < nw; i++) {
            let xworld = nminx + (nw <= 1 ? 0 : i * (nmaxx - nminx) / (nw - 1));
            let dx = xworld - cx, dy = yworld - cy;
            let ox = cx + dx * invcos - dy * invsin;
            let oy = cy + dx * invsin + dy * invcos;
            let fx = (ow < 1e-9) ? 0 : (ox - xmin) / ow * (w - 1);
            let fy = (oh < 1e-9) ? 0 : (1 - (oy - ymin) / oh) * (h - 1);
            let hv = 0;
            if (pointInBoundsMain(ox, oy, mask, soft))
                hv = sampleHeightBGRA(bitmap, w, h, fx, fy);
            encodeHeightBGRA(hv, outBuf, (j * nw + i) * 4);
        }
        let pct = Math.floor(j / nh * 100);
        if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            if (win) win.webContents.send('progress', { stage: 'Rotate heightmap', pct: pct });
        }
    }

    let outImg = nativeImage.createFromBitmap(outBuf, { width: nw, height: nh, scaleFactor: 1.0 });
    fs.writeFileSync(arg.outFile, outImg.toPNG());
    if (win) win.webContents.send('progress', { stage: 'Rotate heightmap', pct: 100 });

    return {
        file: arg.outFile,
        width: nmaxx - nminx,
        height: nmaxy - nminy,
        offsetX: nminx,
        offsetY: nminy,
        cx: cx,
        cy: cy,
        angleDeg: angleDeg,
    };
}

function unrotateHeightmapSync(arg) {
    let img = loadNativeImage(arg.srcFile);
    let size = img.getSize();
    let rw = size.width, rh = size.height;
    let bitmap = img.toBitmap();
    let meta = arg.meta;
    let origin = plainXYZ(arg.origin);
    let meshMin = plainXYZ(arg.mesh && arg.mesh.min);
    let meshMax = plainXYZ(arg.mesh && arg.mesh.max);
    let outW = Math.max(2, arg.outW | 0);
    let outH = Math.max(2, arg.outH | 0);

    let xmin = meshMin.x - origin.x;
    let xmax = meshMax.x - origin.x;
    let ymin = meshMin.y - origin.y;
    let ymax = meshMax.y - origin.y;
    let ow = xmax - xmin, oh = ymax - ymin;
    let cx = meta.cx, cy = meta.cy;
    let rad = -meta.angleDeg * Math.PI / 180;
    let cos = Math.cos(rad), sin = Math.sin(rad);
    let nminx = meta.offsetX, nminy = meta.offsetY;

    let outBuf = Buffer.alloc(outW * outH * 4);
    for (let j = 0; j < outH; j++) {
        let yworld = ymax - (outH <= 1 ? 0 : j * oh / (outH - 1));
        for (let i = 0; i < outW; i++) {
            let xworld = xmin + (outW <= 1 ? 0 : i * ow / (outW - 1));
            let dx = xworld - cx, dy = yworld - cy;
            let rx = cx + dx * cos - dy * sin;
            let ry = cy + dx * sin + dy * cos;
            let fx = (meta.width < 1e-9) ? 0 : (rx - nminx) / meta.width * (rw - 1);
            let fy = (meta.height < 1e-9) ? 0 : (1 - (ry - nminy) / meta.height) * (rh - 1);
            let hv = sampleHeightBGRA(bitmap, rw, rh, fx, fy);
            encodeHeightBGRA(hv, outBuf, (j * outW + i) * 4);
        }
    }
    let outImg = nativeImage.createFromBitmap(outBuf, { width: outW, height: outH, scaleFactor: 1.0 });
    fs.writeFileSync(arg.outFile, outImg.toPNG());
    return arg.outFile;
}

function unrotateGcodeSync(gcodePath, meta) {
    let data = fs.readFileSync(gcodePath, 'utf8');
    let rad = meta.angleDeg * Math.PI / 180;
    let cos = Math.cos(rad), sin = Math.sin(rad);
    let cx = meta.cx, cy = meta.cy;
    let lines = data.split(/\r?\n/);
    let curX = cx, curY = cy;
    let out = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (/^G0*[01](?!\d)/i.test(line)) {
            let xm = line.match(/\bX([+\-0-9.]+)/i);
            let ym = line.match(/\bY([+\-0-9.]+)/i);
            if (xm) curX = parseFloat(xm[1]);
            if (ym) curY = parseFloat(ym[1]);
            let dx = curX - cx, dy = curY - cy;
            let nx = cx + dx * cos - dy * sin;
            let ny = cy + dx * sin + dy * cos;
            if (xm)
                line = line.replace(/\bX[+\-0-9.]+/i, 'X' + nx.toFixed(4));
            else
                line = line.replace(/^(G0*[01])/i, '$1 X' + nx.toFixed(4));
            if (ym)
                line = line.replace(/\bY[+\-0-9.]+/i, 'Y' + ny.toFixed(4));
            else
                line = line.replace(/^(G0*[01](?:\s*X[+\-0-9.]+)?)/i, '$1 Y' + ny.toFixed(4));
        }
        out.push(line);
    }
    fs.writeFileSync(gcodePath, out.join('\n'));
}

function pointInBoundsClip(x, y, b, eps) {
    eps = eps || 1e-6;
    return x >= b.xmin - eps && x <= b.xmax + eps && y >= b.ymin - eps && y <= b.ymax + eps;
}

function clipSegmentBox(x0, y0, x1, y1, b) {
    let dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    let p = [-dx, dx, -dy, dy];
    let q = [x0 - b.xmin, b.xmax - x0, y0 - b.ymin, b.ymax - y0];
    for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-12) {
            if (q[i] < 0) return null;
            continue;
        }
        let r = q[i] / p[i];
        if (p[i] < 0) {
            if (r > t1) return null;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return null;
            if (r < t1) t1 = r;
        }
    }
    return {
        x0: x0 + t0 * dx, y0: y0 + t0 * dy,
        x1: x0 + t1 * dx, y1: y0 + t1 * dy,
        t0: t0, t1: t1,
    };
}

/** Clip toolpath to stock rectangle (same rules as renderer clipGcodeToStockBounds). */
function clipGcodeToStockSync(gcodePath, bounds, safeZ) {
    if (!bounds) return;
    let b = {
        xmin: bounds.xmin - 0.05, xmax: bounds.xmax + 0.05,
        ymin: bounds.ymin - 0.05, ymax: bounds.ymax + 0.05,
    };
    let data = fs.readFileSync(gcodePath, 'utf8');
    let lines = data.split(/\r?\n/);
    let curX = (bounds.xmin + bounds.xmax) / 2;
    let curY = (bounds.ymin + bounds.ymax) / 2;
    let curZ = safeZ;
    let lastF = 10000;
    let out = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (!/^G0*[01](?!\d)/i.test(line)) { out.push(line); continue; }
        let codeIs1 = /^G0*1(?!\d)/i.test(line);
        let xm = line.match(/\bX([+\-0-9.]+)/i);
        let ym = line.match(/\bY([+\-0-9.]+)/i);
        let zm = line.match(/\bZ([+\-0-9.]+)/i);
        let fm = line.match(/\bF([+\-0-9.]+)/i);
        if (fm) lastF = parseFloat(fm[1]);
        let nx = xm ? parseFloat(xm[1]) : curX;
        let ny = ym ? parseFloat(ym[1]) : curY;
        let nz = zm ? parseFloat(zm[1]) : curZ;
        let isCut = codeIs1 && lastF < 8000;
        let prevInside = pointInBoundsClip(curX, curY, b);
        let nextInside = pointInBoundsClip(nx, ny, b);
        if (prevInside && nextInside) {
            out.push(line);
        } else if (!prevInside && !nextInside) {
            // Diagonal angled passes often have BOTH ends outside the stock
            // rectangle while the middle crosses it — keep the clipped middle.
            let clipped = clipSegmentBox(curX, curY, nx, ny, b);
            if (clipped && isCut) {
                let z0 = curZ + clipped.t0 * (nz - curZ);
                let z1 = curZ + clipped.t1 * (nz - curZ);
                out.push('G1 Z' + safeZ.toFixed(4) + ' F10000');
                out.push('G1 X' + clipped.x0.toFixed(4) + ' Y' + clipped.y0.toFixed(4) + ' F10000');
                out.push('G1 Z' + z0.toFixed(4) + ' F' + lastF);
                out.push('G1 X' + clipped.x1.toFixed(4) + ' Y' + clipped.y1.toFixed(4) + ' Z' + z1.toFixed(4) + ' F' + lastF);
                out.push('G1 Z' + safeZ.toFixed(4) + ' F10000');
                lastF = 10000;
            } else if (!isCut) {
                out.push(line);
            }
        } else {
            let clipped = clipSegmentBox(curX, curY, nx, ny, b);
            if (!clipped) {
                if (!isCut) out.push(line);
            } else if (prevInside && !nextInside) {
                let zPart = ' Z' + (curZ + clipped.t1 * (nz - curZ)).toFixed(4);
                out.push('G1 X' + clipped.x1.toFixed(4) + ' Y' + clipped.y1.toFixed(4) + zPart + ' F' + lastF);
                if (isCut) { out.push('G1 Z' + safeZ.toFixed(4) + ' F10000'); lastF = 10000; }
            } else if (isCut) {
                out.push('G1 Z' + safeZ.toFixed(4) + ' F10000');
                out.push('G1 X' + clipped.x0.toFixed(4) + ' Y' + clipped.y0.toFixed(4) + ' F10000');
                let zEntry = curZ + clipped.t0 * (nz - curZ);
                out.push('G1 Z' + zEntry.toFixed(4) + ' F' + lastF);
                out.push('G1 X' + nx.toFixed(4) + ' Y' + ny.toFixed(4) + ' Z' + nz.toFixed(4) + ' F' + lastF);
            } else {
                out.push(line);
            }
        }
        curX = nx; curY = ny; curZ = nz;
    }
    fs.writeFileSync(gcodePath, out.join('\n'));
}

function countCuttingMoves(gcodePath) {
    let data = fs.readFileSync(gcodePath, 'utf8');
    let lastF = 10000, n = 0;
    for (let line of data.split(/\r?\n/)) {
        if (!/^G0*1(?!\d)/i.test(line)) continue;
        let fm = line.match(/\bF([+\-0-9.]+)/i);
        if (fm) lastF = parseFloat(fm[1]);
        if (lastF < 8000) n++;
    }
    return n;
}

ipcMain.on('rotate-heightmap', (event, arg, replychan) => {
    try {
        win.webContents.send(replychan, rotateHeightmapSync(arg));
    } catch (e) {
        console.log(e);
        win.webContents.send(replychan, { error: String(e) });
    }
});

ipcMain.on('unrotate-heightmap', (event, arg, replychan) => {
    try {
        win.webContents.send(replychan, { file: unrotateHeightmapSync(arg) });
    } catch (e) {
        console.log(e);
        win.webContents.send(replychan, { error: String(e) });
    }
});

/**
 * Full angled CAM in one main-process call: rotate → pngcam → unrotate G-code
 * (+ optional stock heightmap). Avoids fragile renderer/canvas IPC chains.
 */
ipcMain.on('generate-angled-toolpath', (event, arg, replychan) => {
    let replied = false;
    let reply = (payload) => {
        if (replied) return;
        replied = true;
        win.webContents.send(replychan, payload);
    };
    let logDir = arg.gcodepath ? path.dirname(arg.gcodepath) : null;
    try {
        angledLog(logDir, 'start', {
            angleDeg: arg.angleDeg,
            heightmap: arg.heightmap,
            resolution: arg.resolution,
            depth: arg.depth,
            offsetZ: arg.offsetZ,
            mesh: arg.mesh,
            origin: arg.origin,
        });

        if (!arg.heightmap || !fs.existsSync(arg.heightmap))
            throw new Error('Heightmap missing: ' + arg.heightmap);
        if (!isFinite(Number(arg.angleDeg)))
            throw new Error('Invalid cut angle: ' + arg.angleDeg);

        // Mask heightmap to the stock rectangle (origin-relative) so pngcam
        // never sees geometry outside the blank. Post-clip remains as a safety net.
        let stockBounds = arg.stockBounds || null;
        let rotatedFile = arg.rotatedFile;
        let meta = rotateHeightmapSync({
            srcFile: arg.heightmap,
            outFile: rotatedFile,
            angleDeg: arg.angleDeg,
            resolution: arg.resolution,
            mesh: arg.mesh,
            origin: arg.origin,
            stockBounds: stockBounds,
        });
        angledLog(logDir, 'rotated', { ...meta, stockBounds: stockBounds });

        let rotatedReadStock = null;
        if (arg.read_stock && fs.existsSync(arg.read_stock)) {
            try {
                let rsOut = arg.rotatedStockFile || (rotatedFile + '.stock.png');
                rotateHeightmapSync({
                    srcFile: arg.read_stock,
                    outFile: rsOut,
                    angleDeg: arg.angleDeg,
                    resolution: arg.resolution,
                    mesh: arg.mesh,
                    origin: arg.origin,
                    stockBounds: stockBounds,
                });
                rotatedReadStock = rsOut;
            } catch (e) {
                angledLog(logDir, 'read-stock rotate failed', String(e));
                rotatedReadStock = null;
            }
        }

        // Prefer explicit numeric fields from renderer (survives IPC cleanly)
        let tool = (arg.job && arg.job.tool) || {};
        let ctl = (arg.job && arg.job.controller) || {};
        let jp = (arg.job && arg.job.path) || {};
        let diameter = Number(tool.diameter) || 6;
        let stepover = Number(jp.stepover);
        if (!(stepover > 0) && jp.stepover_percent != null)
            stepover = diameter * Number(jp.stepover_percent) / 100;
        if (!(stepover > 0)) stepover = diameter * 0.5;
        let stepdown = Number(jp.stepdown) || diameter;
        let depth = Number(arg.depth);
        if (!(depth > 0)) throw new Error('Invalid model depth: ' + arg.depth);
        let offsetZ = Number(arg.offsetZ);
        if (!isFinite(offsetZ)) throw new Error('Invalid Z offset');

        let opts = [
            '--tool-shape', tool.shape || 'ball',
            '--tool-diameter', diameter,
            '--step-down', stepdown,
            '--step-over', stepover,
            '--xy-feed-rate', Number(ctl.xyfeed) || 1000,
            '--z-feed-rate', Number(ctl.zfeed) || 100,
            '--speed', Number(ctl.rpm) || 12000,
            '--clearance', Number(jp.clearance) || 0,
            '--rapid-clearance', Number(ctl.safez) || 5,
            '--route', 'horizontal',
            '--width', meta.width,
            '--height', meta.height,
            '--depth', depth,
            '--x-offset', meta.offsetX,
            '--y-offset', meta.offsetY,
            '--z-offset', offsetZ,
            '--max-vel', settings.maxvel,
            '--max-accel', settings.maxaccel,
            '--write-stock', arg.write_stock,
            '--rgb',
        ];
        if (jp.roughingonly) opts.push('--roughing-only');
        if (jp.rampentry) opts.push('--ramp-entry');
        if (jp.omittop) opts.push('--omit-top');
        // Outside-stock pixels are black after masking — omit-bottom skips cutting them
        if (stockBounds || jp.omitbottom) opts.push('--omit-bottom');
        if (jp.clearbottom) opts.push('--deep-black');
        // Never cut beyond edges for angled — keep tool inside blank
        if (jp.clearedges && !stockBounds) opts.push('--beyond-edges');
        if (arg.imperial) opts.push('--imperial');
        if (rotatedReadStock) {
            opts.push('--read-stock');
            opts.push(rotatedReadStock);
        }
        opts.push(meta.file);
        angledLog(logDir, 'pngcam', opts.map(String));

        let gcodeFile = arg.gcodepath;
        runPngcamToGcode(opts, gcodeFile, function(err, result) {
            if (err) {
                angledLog(logDir, 'pngcam error', err);
                reply({ error: err });
                return;
            }
            if (!result || !result.file) {
                reply({ file: null });
                return;
            }
            try {
                let cutsBefore = countCuttingMoves(gcodeFile);
                angledLog(logDir, 'cuts raw', cutsBefore);
                unrotateGcodeSync(gcodeFile, meta);
                let cutsUnrot = countCuttingMoves(gcodeFile);
                angledLog(logDir, 'cuts after unrotate', cutsUnrot);
                let safeZ = (Number(ctl.safez) || 5) + (Number(offsetZ) || 0);
                // Always clip: stock bounds, or model AABB fallback. Inset by tool radius
                // so the cutter body stays inside the blank, not just the tool centre.
                let clipBounds = stockBounds;
                if (!clipBounds && arg.mesh && arg.mesh.min && arg.mesh.max && arg.origin) {
                    clipBounds = {
                        xmin: Number(arg.mesh.min.x) - Number(arg.origin.x),
                        xmax: Number(arg.mesh.max.x) - Number(arg.origin.x),
                        ymin: Number(arg.mesh.min.y) - Number(arg.origin.y),
                        ymax: Number(arg.mesh.max.y) - Number(arg.origin.y),
                    };
                }
                if (clipBounds) {
                    let inset = Math.max(0, diameter * 0.5);
                    let cb = {
                        xmin: clipBounds.xmin + inset,
                        xmax: clipBounds.xmax - inset,
                        ymin: clipBounds.ymin + inset,
                        ymax: clipBounds.ymax - inset,
                    };
                    if (cb.xmax > cb.xmin && cb.ymax > cb.ymin) {
                        angledLog(logDir, 'clip bounds', cb);
                        clipGcodeToStockSync(gcodeFile, cb, safeZ);
                    }
                }
                let cuts = countCuttingMoves(gcodeFile);
                angledLog(logDir, 'cuts after clip', cuts);
                if (cuts < 2)
                    throw new Error(t('err_angled_empty'));

                let heightmap_file = arg.write_stock;
                if (arg.write_stock && fs.existsSync(arg.write_stock) && arg.stockOutW && arg.stockOutH) {
                    try {
                        unrotateHeightmapSync({
                            srcFile: arg.write_stock,
                            outFile: arg.write_stock,
                            meta: meta,
                            mesh: arg.mesh,
                            origin: arg.origin,
                            outW: arg.stockOutW,
                            outH: arg.stockOutH,
                        });
                    } catch (e) {
                        angledLog(logDir, 'unrotate stock failed', String(e));
                    }
                }
                reply({
                    file: gcodeFile,
                    heightmap_file: heightmap_file,
                    cycletime: result.cycletime,
                    meta: meta,
                    cuts: cuts,
                });
            } catch (e) {
                angledLog(logDir, 'postprocess error', String(e));
                reply({ error: String(e) });
            }
        });
    } catch (e) {
        angledLog(logDir, 'fatal', String(e));
        console.log(e);
        reply({ error: String(e) });
    }
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
    try {
        fs.mkdirSync(path.dirname(settingsfile), { recursive: true });
        fs.writeFileSync(settingsfile, JSON.stringify(settings));
    } catch (err) {
        console.log(err);
    }
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
        filters: [
            {name: t('filter_project'), extensions: ["meshmill"]},
            {name: t('filter_stl'), extensions: ["stl"]},
            {name: t('filter_all'), extensions:["*"]},
        ],
    });
    if (newfilename) {
        // Only remember .meshmill paths as the project filename; STL opens as a new project.
        if (newfilename[0].toLowerCase().endsWith('.meshmill'))
            setFilename(newfilename[0]);
        else
            setFilename(null);
        return newfilename[0];
    }
    return newfilename;
}
