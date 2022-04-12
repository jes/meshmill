function Project() {
    this.jobs = [];
    this.stl = '';
    this.heightmap = '';
    this.mesh = {};
    this.resolution = 0.25;
    this.bottomside = false;
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
            clearbottom: false,
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

Project.prototype.loadSTL = function(file, cb) {
    this.stl = file;
    var project = this;
    (new THREE.STLLoader()).load(file, function (geometry) {
        geometry.computeBoundingBox();
        var bb = geometry.boundingBox;
        project.mesh.min = bb.min;
        project.mesh.max = bb.max;
        project.mesh.width = bb.max.x-bb.min.x;
        project.mesh.height = bb.max.y-bb.min.y;
        project.mesh.depth = bb.max.z-bb.min.z;
        if (cb) cb();
    });
};

Project.prototype.renderHeightmap = function(cb) {
    var width = this.mesh.width / this.resolution;
    var project = this;
    window.api.receive('heightmap', function(r) {
        if (r.error)
            alert(r.error);
        project.heightmap = r.file;
        cb(r.file);
    });
    window.api.send('render-heightmap', {
        stl: this.stl,
        width: width,
        bottom: this.bottomside,
    });
};

Project.prototype.generateToolpath = function(id, cb) {
    window.api.receive('toolpath', function(r) {
        if (r.error)
            alert(r.error);
        cb(r.file);
    });
    window.api.send('generate-toolpath', {
        job: this.jobs[id],
        heightmap: this.heightmap,
        width: this.mesh.width,
        depth: this.mesh.depth,
        offset: {
            x: this.mesh.min.x,
            y: this.mesh.max.y,
            z: this.mesh.max.z,
        },
    });
};

window.api.send('get-heightmap');
