const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    send: (channel,data) => {
        ipcRenderer.send(channel, data);
    },
    receiveAll: (channel,func) => {
        ipcRenderer.on(channel, (_,...args) => func(...args));
    },
    receive: (channel,func) => {
        ipcRenderer.once(channel, (_,...args) => func(...args));
    },
});
