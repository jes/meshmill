let SAVE_FIELDS = ['jobs', 'stl', 'heightmap', 'mesh', 'resolution', 'bottomside'];

function Project(cb) {
    this.jobs = [];
    this.stl = '';
    this.heightmap = null;
    this.mesh = {};
    this.resolution = 0.25;
    this.bottomside = false;

    this.dirty = false;
    this.tmpdir = null;

    let project = this;
    window.api.send('tmpdir', function(dir) {
        project.tmpdir = dir;
        if (cb) cb(project)
    });
}

// TODO: clone last job instead of starting afresh
Project.prototype.addJob = function() {
    this.dirty = true;
    let defaultJob = {
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
    };

    let clone = function(obj) {
        return JSON.parse(JSON.stringify(obj));
    };

    // copy last job if any
    let newJob = this.jobs.length ? clone(this.jobs[this.jobs.length-1]) : defaultJob;

    this.jobs.push(newJob);

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

    // TODO: we need to keep track of the original path on disk,
    // so that "reload from disk" has any chance of working after
    // we re-open the project
    window.api.send('copy-file', {
        src: file,
        dst: workingfile,
    }, function(newfile) {
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
};

Project.prototype.renderHeightmap = function(cb) {
    this.dirty = true;
    var width = this.mesh.width / this.resolution;
    var project = this;
    window.api.send('render-heightmap', {
        stl: this.stl,
        width: width,
        bottom: this.bottomside,
    }, function(r) {
        if (r.error)
            alert(r.error);
        project.heightmap = r.file;
        cb(r.file);
    });
};

Project.prototype.generateToolpath = function(id, cb) {
    this.dirty = true;
    var project = this;
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
    }, function(r) {
        if (r.error)
            alert(r.error);
        project.jobs[id].gcodefile = r.file;
        cb(r.file);
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

Project.prototype.save = function(filename) {
    let project = this;

    let obj = {};
    for (var i = 0; i < SAVE_FIELDS.length; i++) {
        let field = SAVE_FIELDS[i];
        obj[field] = this[field];
    }
    let json = JSON.stringify(obj);
    // XXX: could workingDir() plausibly coincide with some text
    // that happens to exist in places we don't want to replace it?
    let newjson = json.replaceAll(this.workingDir(), "$TMPDIR$");
    console.log(newjson);

    // 1. write out json of the state
    window.api.send('write-file', {
        file: this.workingDir() + "/project.json",
        data: newjson,
    }, function(err) {
        if (err) {
            alert(err);
            return;
        }

        // 2. tar up the directory
        window.api.send('tar-up', {
            dir: project.workingDir(),
            dest: filename,
        }, function(err) {
            if (err) {
                alert(err);
                return;
            }

            // 3. done!
            project.dirty = false;
        });
    });
};

Project.prototype.open = function(filename, cb) {
    let project = this;

    // 1. untar the project file
    window.api.send('untar', {
        file: filename,
        dir: this.workingDir(),
    }, function(err) {
        console.log("untarred to " + project.workingDir());
        if (err) {
            alert(err);
            return;
        }

        // 2. load state from the json
        window.api.send('read-file', project.workingDir() + "/project.json", function(r) {
            if (r.err) {
                alert(r.err);
                return;
            }

            // XXX: could $TMPDIR$ plausibly exist somewhere
            // we don't want to replace it?
            let json = r.data.replaceAll("$TMPDIR$", project.workingDir());
            let obj = JSON.parse(json);
            for (var i = 0; i < SAVE_FIELDS.length; i++) {
                let field = SAVE_FIELDS[i];
                project[field] = obj[field];
            }

            // 3. done!
            console.log("FINISHED LOADING");
            project.dirty = false;
            cb();
        });
    });
};
