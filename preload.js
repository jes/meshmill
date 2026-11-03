const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
    send: (channel,data,cb) => { // or (channel,cb)
        if (data instanceof Function) {
            cb = data;
            data = undefined;
        }
        let replychan = null;
        if (cb) {
            replychan = channel + "-" + Math.random();
            ipcRenderer.once(replychan, (event,data) => {cb(data)});
        };
        ipcRenderer.send(channel, data, replychan);
    },
    receive: (channel,func) => {
        ipcRenderer.on(channel, (_,...args) => func(...args));
    },
    /** Resolve filesystem path for a File from <input type=file> (Electron). */
    pathForFile: (file) => {
        if (!file) return null;
        try {
            if (webUtils && typeof webUtils.getPathForFile === 'function')
                return webUtils.getPathForFile(file) || null;
        } catch (e) {}
        return file.path || null;
    },
});
