const path = require('path');
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
    let render = spawn('pngcam-render', ['--border', '0', '--width', arg.width, arg.stl]);

    render.stderr.on('data', (data) => {
        console.log(""+data);
    });

    render.stdout.on('data', (data) => {
        console.log(""+data);
    });
    
    render.on('close', (code) => {
        if (code !== 0) console.log(`pngcam-render exited with code ${code}`);
        win.webContents.send('heightmap', `${arg.stl}.png`);
    });
});
