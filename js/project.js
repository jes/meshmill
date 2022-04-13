function Project() {
    this.jobs = [];
    this.stl = '';
    this.heightmap = null;
    this.mesh = {};
    this.resolution = 0.25;
    this.bottomside = false;
    this.dirty = false;
    this.tmpdir = null;

    // TODO: a better way for request-response calls to the main process?
    let project = this;
    window.api.receive('tmpdir', function(dir) {
        project.tmpdir = dir;
    });
    window.api.send('tmpdir');
}

// TODO: clone last job instead of starting afresh
Project.prototype.addJob = function() {
    this.dirty = true;
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
            stepdown: 6,
            clearance: 0,
            roughingonly: false,
            rampentry: false,
            omittop: false,
            clearbottom: false,
        },
        gcodefile: null,
    });
    return this.jobs.length-1;
};

Project.prototype.deleteJob = function(id) {
    this.dirty = true;
    this.jobs.splice(id, 1);
};

Project.prototype.getJob = function(id) {
    return this.jobs[id];
};

Project.prototype.loadSTL = function(file, cb) {
    this.dirty = true;
    this.heightmap = null;

    let workingfile = this.workingDir() + "/mesh.stl";

    var project = this;

    // TODO: is there a better way to talk to the main process?
    window.api.receive('copy-file', function(newfile) {
        if (!newfile) throw "Couldn't copy " + file + " to " + workingfile;
        project.stl = workingfile;
        (new THREE.STLLoader()).load(project.stl, function (geometry) {
            geometry.computeBoundingBox();
            var bb = geometry.boundingBox;
            project.mesh.min = bb.min;
            project.mesh.max = bb.max;
            project.mesh.width = bb.max.x-bb.min.x;
            project.mesh.height = bb.max.y-bb.min.y;
            project.mesh.depth = bb.max.z-bb.min.z;
            if (cb) cb();
        });
    });

    window.api.send('copy-file', {
        src: file,
        dst: workingfile,
    });
};

Project.prototype.renderHeightmap = function(cb) {
    this.dirty = true;
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
    this.dirty = true;
    window.api.receive('toolpath', function(r) {
        if (r.error)
            alert(r.error);
        project.jobs[id].gcodefile = r.file;
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

Project.prototype.saveGcode = function(id) {
    window.api.send('save-file', {
        file: this.jobs[id].gcodefile,
    });
};

Project.prototype.workingDir = function() {
    if (this.tmpdir) return this.tmpdir;
    else throw "tmpdir not set yet";
};
