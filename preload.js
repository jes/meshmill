const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    send: (channel,data,cb) => { // or (channel,cb)
        console.log("SEND: " + channel);
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
});
