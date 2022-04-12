function Project() {
    this.jobs = [];
    this.stl = '';
    this.resolution = 0.1;
}

Project.prototype.addJob = function() {
    this.jobs.push({
        tool: {
            shape: 'ball',
            diameter: 6,
        },
        controller: {
            xyfeed: 1000,
            zfeed: 100,
            safez: 5,
            rpm: 12000,
        },
        path: {
            direction: 'horizontal',
            stepover: 3,
            stepdown: 20,
            clearance: 0,
            roughingonly: false,
            rampentry: false,
            omittop: false,
        },
    });
    return this.jobs.length-1;
};

Project.prototype.deleteJob = function(id) {
    this.jobs.splice(id, 1);
};

Project.prototype.getJob = function(id) {
    return this.jobs[id];
};

Project.prototype.renderHeightmap = function(cb) {
    window.api.send('render-heightmap', {
        stl: this.stl,
        resolution: this.resolution,
    });
    window.api.receive('heightmap', function(file) {
        HeightmapViewer(file);
    });
};

Project.prototype.getToolpath = function() {
};

window.api.send('get-heightmap');
