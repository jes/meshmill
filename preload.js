const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    send: (channel,data,cb) => {
        let replychan = null;
        if (cb) {
            replychan = channel + "-" + Math.random();
            ipcRenderer.once(replychan, (event,data) => {cb(data)});
        };
        ipcRenderer.send(channel, data, replychan);
    },
    receiveAll: (channel,func) => {
        ipcRenderer.on(channel, (_,...args) => func(...args));
    },
    receive: (channel,func) => {
        ipcRenderer.once(channel, (_,...args) => func(...args));
    },
});
