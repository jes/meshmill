const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');

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
})

ipcMain.on('render-heightmap', (event,arg) => {
    let opts = ['--border', '0', '--width', arg.width];
    if (arg.bottom) opts.push('--bottom');

    opts.push(arg.stl);
    let render = spawn('pngcam-render', opts);

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
        if (code !== 0) console.log(`pngcam-render exited with code ${code}`);
        win.webContents.send('heightmap', `${arg.stl}.png`);
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
    ];
    if (arg.roughingonly) opts.push('--roughing-only');
    if (arg.rampentry) opts.push('--ramp-entry');
    if (arg.omittop) opts.push('--omit-top');
    if (arg.clearbottom) opts.push('--deep-black');

    opts.push(arg.heightmap);
    let gcodeFile = '/home/jes/gcode';
    let gcodeStream = fs.createWriteStream(gcodeFile);
    gcodeStream.on('open', function() {
        let pngcam = spawn('pngcam', opts, {
            stdio: ['pipe', gcodeStream, 'pipe'], // send stdout to a file
        });

        pngcam.stderr.on('data', (data) => {
            process.stderr.write(""+data);
            let match = (""+data).match(/(\d+)%/);
            if (match) {
                win.webContents.send('progress', match[1]);
            }
        });

        pngcam.on('close', (code) => {
            if (code !== 0) console.log(`pngcam exited with code ${code}`);
            win.webContents.send('toolpath', gcodeFile);
        });
    });
});
