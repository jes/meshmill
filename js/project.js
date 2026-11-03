let SAVE_FIELDS = ['jobs', 'stl', 'stl_original', 'heightmap', 'mesh', 'resolution', 'bottomside', 'imperial', 'xyorigin', 'zorigin', 'dirty_model', 'ui', 'rotary', 'stock', 'scalelock', 'scalepercent'];

function Project(cb) {
    this.jobs = [];
    this.stl = '';
    this.stl_original = null;
    this.heightmap = null;
    this.mesh = {};
    this.resolution = 0.5;
    this.bottomside = false;
    this.imperial = Settings.imperial;
    this.xyorigin = 'fromstl';
    this.zorigin = 'fromstl';
    this.rotary = false;
    this.stock = { x: 100, y: 100, z: 20 };
    this.scalelock = true;
    this.scalepercent = 100;

    this.dirty_model = false;
    this.ui = {};

    this.dirty = false;
    this.tmpdir = null;

    let project = this;
    window.api.send('tmpdir', function(dir) {
        project.tmpdir = dir;
        if (cb) cb(project)
    });
}

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
            omitbottom: false,
            clearbottom: false,
            clearedges: false,
        },
        gcodefile: null,
        outputheightmap: null,
        cycletime: null,
        dirty: true,
    };

    let clone = function(obj) {
        return JSON.parse(JSON.stringify(obj));
    };

    // copy last job if any
    let newJob = this.jobs.length ? clone(this.jobs[this.jobs.length-1]) : defaultJob;

    newJob.gcodefile = null;
    newJob.outputheightmap = null;
    newJob.cycletime = null;
    newJob.dirty = true;

    this.jobs.push(newJob);

    return this.jobs.length-1;
};

Project.prototype.deleteJob = function(id) {
    this.dirty = true;
    this.jobs.splice(id, 1);
};

Project.prototype.duplicateJob = function(id) {
    let clone = JSON.parse(JSON.stringify(this.jobs[id]));
    clone.gcodefile = null;
    clone.outputheightmap = null;
    clone.cycletime = null;
    clone.dirty = true;
    this.jobs.splice(id+1, 0, clone);
    this.dirty = true;
    for (let i = id+2; i < this.jobs.length; i++)
        this.jobs[i].dirty = true;
    return id+1;
};

Project.prototype.getJob = function(id) {
    return this.jobs[id];
};

Project.prototype.jobReady = function(id) {
    if (this.dirty_model) return false;
    for (var i = 0; i <= id; i++) {
        if (this.jobs[i].dirty)
            return false;
    }
    return true;
};

Project.prototype.dirtyModel = function() {
    this.dirty = true;
    this.dirty_model = true;
};

Project.prototype.dirtyJob = function(id) {
    if (id >= this.jobs.length)
        return;
    this.dirty = true;
    this.jobs[id].dirty = true;
};

Project.prototype.loadSTL = function(file, cb) {
    this.dirtyModel();
    this.heightmap = null;

    let workingfile = this.workingDir() + "/mesh.stl";

    var project = this;

    window.api.send('copy-file', {
        src: file,
        dst: workingfile,
    }, function(newfile) {
        if (!newfile) throw "Couldn't copy " + file + " to " + workingfile;
        project.stl = workingfile;
        project.stl_original = file;
        (new THREE.STLLoader()).load(project.stl, function (geometry) {
            geometry.computeBoundingBox();
            var bb = geometry.boundingBox;
            project.mesh.triangles = geometry.attributes.position.array.length/9;
            project.mesh.min = bb.min;
            project.mesh.max = bb.max;
            project.mesh.width = bb.max.x-bb.min.x;
            project.mesh.height = bb.max.y-bb.min.y;
            project.mesh.lineardepth = bb.max.z-bb.min.z;
            project.mesh.rotarydepth = maxRadius(geometry);
            project.calculateOrigin();
            project.setRotary(project.rotary);
            if (cb) cb();
        });
    });
};

function geometryToBinarySTL(geometry) {
    let pos = geometry.attributes.position;
    let triangles = Math.floor(pos.count / 3);
    let buffer = new ArrayBuffer(84 + triangles * 50);
    let dv = new DataView(buffer);
    dv.setUint32(80, triangles, true);
    let o = 84;
    for (let t = 0; t < triangles; t++) {
        let i = t*3;
        let ax=pos.getX(i), ay=pos.getY(i), az=pos.getZ(i);
        let bx=pos.getX(i+1), by=pos.getY(i+1), bz=pos.getZ(i+1);
        let cx=pos.getX(i+2), cy=pos.getY(i+2), cz=pos.getZ(i+2);
        let ux=bx-ax, uy=by-ay, uz=bz-az;
        let vx=cx-ax, vy=cy-ay, vz=cz-az;
        let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
        let len=Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
        dv.setFloat32(o, nx/len, true);
        dv.setFloat32(o+4, ny/len, true);
        dv.setFloat32(o+8, nz/len, true);
        dv.setFloat32(o+12, ax, true);
        dv.setFloat32(o+16, ay, true);
        dv.setFloat32(o+20, az, true);
        dv.setFloat32(o+24, bx, true);
        dv.setFloat32(o+28, by, true);
        dv.setFloat32(o+32, bz, true);
        dv.setFloat32(o+36, cx, true);
        dv.setFloat32(o+40, cy, true);
        dv.setFloat32(o+44, cz, true);
        dv.setUint16(o+48, 0, true);
        o += 50;
    }
    return new Uint8Array(buffer);
}

Project.prototype.scaleSTL = function(sx, sy, sz, cb) {
    let project = this;
    window.api.send('read-file-binary', this.stl, function(r) {
        if (r.err) {
            alert(r.err);
            return;
        }
        let data = r.data;
        let ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        let geometry = (new THREE.STLLoader()).parse(ab);
        geometry.computeBoundingBox();
        let mn = geometry.boundingBox.min;
        let pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            pos.setXYZ(i,
                mn.x + (pos.getX(i) - mn.x) * sx,
                mn.y + (pos.getY(i) - mn.y) * sy,
                mn.z + (pos.getZ(i) - mn.z) * sz);
        }
        pos.needsUpdate = true;
        geometry.computeBoundingBox();
        let scaledfile = project.workingDir() + "/mesh-scaled.stl";
        let stl = geometryToBinarySTL(geometry);
        window.api.send('write-file-binary', {
            file: scaledfile,
            data: stl,
        }, function(err) {
            if (err) {
                alert(err);
                return;
            }
            project.stl = scaledfile;
            project.heightmap = null;
            let bb = geometry.boundingBox;
            project.mesh.triangles = pos.count / 3;
            project.mesh.min = bb.min;
            project.mesh.max = bb.max;
            project.mesh.width = bb.max.x - bb.min.x;
            project.mesh.height = bb.max.y - bb.min.y;
            project.mesh.lineardepth = bb.max.z - bb.min.z;
            project.mesh.rotarydepth = maxRadius(geometry);
            project.dirtyModel();
            project.calculateOrigin();
            project.setRotary(project.rotary);
            if (cb) cb();
        });
    });
};

Project.prototype.renderHeightmap = function(cb) {
    var width = Math.ceil(this.mesh.width / this.resolution);
    var height = Math.ceil(this.mesh.height / this.resolution);
    var project = this;
    window.api.send('render-heightmap', {
        stl: this.stl,
        width: width,
        height: height,
        bottom: this.bottomside,
        rotary: this.rotary,
    }, function(r) {
        if (r.error)
            alert(r.error);
        if (r.file) {
            project.dirty_model = false;
            for (var i = 0; i < project.jobs.length; i++)
                project.dirtyJob(i);
            project.heightmap = r.file;
        }
        cb(r.file);
    });
};

Project.prototype.generateToolpath = function(id, cb) {
    var project = this;
    var offset = {
        x: this.mesh.min.x-this.mesh.origin.x,
        y: this.mesh.min.y-this.mesh.origin.y,
        z: this.mesh.max.z-this.mesh.origin.z,
    };
    if (this.rotary) {
        offset.y = 0;
        offset.z = 0;
    }
    window.api.send('generate-toolpath', {
        job: this.jobs[id],
        heightmap: this.heightmap,
        width: this.mesh.width,
        height: this.mesh.height,
        depth: this.mesh.depth,
        offset: offset,
        imperial: this.imperial,
        write_stock: this.workingDir() + "/job-" + id + ".png",
        read_stock: (id > 0 ? this.jobs[id-1].outputheightmap : null),
        gcodepath: this.workingDir() + "/job-" + id + ".gcode",
        rotary: this.rotary,
    }, function(r) {
        if (r.error) {
            alert(r.error);
        }
        if (r.file) {
            project.jobs[id].dirty = false;
            project.dirtyJob(id+1);
            project.jobs[id].gcodefile = r.file;
            project.jobs[id].outputheightmap = r.heightmap_file;
            project.jobs[id].cycletime = r.cycletime;
        }
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

Project.prototype.save = function(filename, cb) {
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

    // 1. write out json of the state
    window.api.send('write-file', {
        file: this.workingDir() + "/project.json",
        data: newjson,
    }, function(err) {
        if (err) {
            alert(err);
            cb(err);
            return;
        }

        // 2. tar up the directory
        window.api.send('tar-up', {
            dir: project.workingDir(),
            dest: filename,
        }, function(err) {
            if (err) {
                alert(err);
                cb(err);
                return;
            }

            // 3. done!
            project.dirty = false;
            cb();
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
            project.dirty = false;
            cb();
        });
    });
};

Project.prototype.calculateOrigin = function() {
    for (var i = 0; i < this.jobs.length; i++)
        this.dirtyJob(i);

    this.mesh.origin = {};

    switch (this.xyorigin) {
    case 'fromstl':
        this.mesh.origin.x = 0;
        this.mesh.origin.y = 0;
        break;
    case 'mincorner':
        this.mesh.origin.x = this.mesh.min.x;
        this.mesh.origin.y = this.mesh.min.y;
        break;
    case 'centre':
        this.mesh.origin.x = (this.mesh.min.x+this.mesh.max.x)/2;
        this.mesh.origin.y = (this.mesh.min.y+this.mesh.max.y)/2;
        break;
    case 'topleft':
        this.mesh.origin.x = this.mesh.min.x;
        this.mesh.origin.y = this.mesh.max.y;
        break;
    case 'bottomleft':
        this.mesh.origin.x = this.mesh.min.x;
        this.mesh.origin.y = this.mesh.min.y;
        break;
    case 'topright':
        this.mesh.origin.x = this.mesh.max.x;
        this.mesh.origin.y = this.mesh.max.y;
        break;
    case 'bottomright':
        this.mesh.origin.x = this.mesh.max.x;
        this.mesh.origin.y = this.mesh.min.y;
        break;
    default:
        throw "illegal xy origin: " + origin;
    }

    switch (this.zorigin) {
    case 'fromstl':
        this.mesh.origin.z = 0;
        break;
    case 'mincorner':
        this.mesh.origin.z = this.mesh.min.z;
        break;
    case 'centre':
        this.mesh.origin.z = (this.mesh.min.z+this.mesh.max.z)/2;
        break;
    case 'top':
        this.mesh.origin.z = this.mesh.max.z;
        break;
    case 'bottom':
        this.mesh.origin.z = this.mesh.min.z;
        break;
    default:
        throw "illegal z origin: " + origin;
    }
};

Project.prototype.setXYOrigin = function(origin) {
    this.xyorigin = origin;
    this.dirty = true;
    this.calculateOrigin();
};

Project.prototype.setZOrigin = function(origin) {
    this.zorigin = origin;
    this.dirty = true;
    this.calculateOrigin();
};

Project.prototype.setRotary = function(r) {
    this.rotary = r;

    if (this.rotary) this.mesh.depth = this.mesh.rotarydepth;
    else this.mesh.depth = this.mesh.lineardepth;
};
