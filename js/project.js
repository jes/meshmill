let SAVE_FIELDS = ['jobs', 'stl', 'stl_cam', 'stl_original', 'heightmap', 'contours', 'contour_file', 'dxf_original', 'mesh', 'resolution', 'bottomside', 'imperial', 'xyorigin', 'zorigin', 'dirty_model', 'ui', 'rotary', 'stock', 'scalelock', 'scalepercent'];

/** Preview triangle budget for THREE.js; larger meshes are auto-decimated. */
var STL_PREVIEW_TARGET = 400000;
/** Soft confirm before auto-decimate (still accepted). */
var STL_CONFIRM_TRIS = 2000000;
/** Hard refuse — even streaming CAM would be unwieldy. */
var STL_HARD_TRIS = 80000000;
var STL_HARD_MB = 1500;

function Project(cb) {
    this.jobs = [];
    this.stl = '';
    this.stl_cam = null; // full-resolution STL for heightmap (may equal stl)
    this.stl_original = null;
    this.heightmap = null;
    this.contours = []; // [{id,name,layer,closed,points:[[x,y],...]}]
    this.contour_file = null;
    this.dxf_original = null;
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
            angle: 45,
            stepover_percent: 50,
            stepdown: 6,
            clearance: 0,
            contour_source: 'heightmap', // or 'dxf:<id>'
            contour_id: 0,
            pocket_style: 'hatch', // hatch | concentric
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

    let previewFile = this.workingDir() + "/mesh.stl";
    let fullFile = this.workingDir() + "/mesh-full.stl";
    var project = this;

    let loadPreviewIntoScene = function() {
        showBusy(i18n.t('loading_stl') || 'Loading STL…');
        (new THREE.STLLoader()).load(project.stl, function (geometry) {
            hideBusy();
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
        }, undefined, function(err) {
            hideBusy();
            alert(String(err || 'STL load failed'));
            if (cb) cb(null);
        });
    };

    window.api.send('stl-info', { file: file }, function(info) {
        if (info && info.error) {
            alert(info.error);
            if (cb) cb(null);
            return;
        }
        let tris = (info && info.triangles) ? info.triangles : null;
        let mb = (info && info.size) ? (info.size / (1024 * 1024)) : 0;
        if ((tris && tris > STL_HARD_TRIS) || mb > STL_HARD_MB) {
            alert(i18n.t('err_stl_too_large',
                tris ? Math.round(tris).toLocaleString() : '?',
                mb.toFixed(0)));
            if (cb) cb(null);
            return;
        }

        let continueLoad = function() {
            let needDecimate = tris && tris > STL_PREVIEW_TARGET;
            window.api.send('copy-file', {
                src: file,
                dst: needDecimate ? fullFile : previewFile,
            }, function(newfile) {
                if (!newfile) {
                    alert("Couldn't copy " + file + " to working dir");
                    if (cb) cb(null);
                    return;
                }
                project.stl_original = file;
                if (!needDecimate) {
                    project.stl = previewFile;
                    project.stl_cam = previewFile;
                    loadPreviewIntoScene();
                    return;
                }
                // Keep full mesh for CAM heightmap; decimate proxy for THREE.
                project.stl_cam = fullFile;
                showBusy(i18n.t('decimating_stl') || 'Simplifying mesh…');
                window.api.send('decimate-stl', {
                    src: fullFile,
                    dst: previewFile,
                    target: STL_PREVIEW_TARGET,
                }, function(r) {
                    if (r && r.error) {
                        hideBusy();
                        alert(r.error);
                        if (cb) cb(null);
                        return;
                    }
                    if (!r || !r.file) {
                        hideBusy();
                        if (cb) cb(null);
                        return;
                    }
                    project.stl = previewFile;
                    if (r.triangles_in && r.triangles_out) {
                        project.mesh.triangles_original = r.triangles_in;
                    }
                    loadPreviewIntoScene();
                });
            });
        };

        if ((tris && tris > STL_CONFIRM_TRIS) || mb > 80) {
            confirmDialog(
                i18n.t('confirm_stl_large',
                    tris ? Math.round(tris).toLocaleString() : '?',
                    mb.toFixed(0)),
                i18n.t('btn_continue') || 'Continue',
                i18n.t('btn_cancel'),
                function(ok) {
                    if (ok) continueLoad();
                    else if (cb) cb(null);
                }
            );
        } else {
            continueLoad();
        }
    });
};

/** Fill project.mesh from CAD bounds when no STL is loaded (2.5D-only workflow). */
Project.prototype.applyCadBounds = function(bounds, contours) {
    let xmin, ymin, xmax, ymax;
    if (bounds && bounds.length >= 4) {
        xmin = +bounds[0]; ymin = +bounds[1]; xmax = +bounds[2]; ymax = +bounds[3];
    } else {
        xmin = ymin = Infinity;
        xmax = ymax = -Infinity;
        let list = contours || this.contours || [];
        for (let i = 0; i < list.length; i++) {
            let pts = list[i].points || [];
            for (let j = 0; j < pts.length; j++) {
                let x = +pts[j][0], y = +pts[j][1];
                if (x < xmin) xmin = x;
                if (y < ymin) ymin = y;
                if (x > xmax) xmax = x;
                if (y > ymax) ymax = y;
            }
        }
    }
    if (!(xmax > xmin) || !(ymax > ymin)) return false;

    // Keep existing STL mesh metrics; only seed mesh for CAD-only projects.
    if (this.stl) return true;

    let depth = (this.stock && this.stock.z > 0) ? +this.stock.z : 10;
    this.mesh = this.mesh || {};
    this.mesh.min = { x: xmin, y: ymin, z: 0 };
    this.mesh.max = { x: xmax, y: ymax, z: depth };
    this.mesh.width = xmax - xmin;
    this.mesh.height = ymax - ymin;
    this.mesh.lineardepth = depth;
    this.mesh.rotarydepth = depth;
    this.mesh.depth = depth;
    this.mesh.triangles = 0;
    this.calculateOrigin();
    return true;
};

Project.prototype.loadDXF = function(file, cb) {
    var project = this;
    let finish = function(contours) {
        try { hideBusy(); } catch (e) {}
        if (cb) cb(contours);
    };
    if (!file) {
        finish(null);
        return;
    }
    if (!this.tmpdir) {
        alert(i18n.t('err_tmpdir') || 'Working directory not ready yet — try again.');
        finish(null);
        return;
    }
    let ext = (file.split('.').pop() || 'dxf').toLowerCase();
    let dst = this.workingDir() + "/contours." + (ext === 'dwg' ? 'dwg' : 'dxf');
    let outJson = this.workingDir() + "/contours.json";
    showBusy(i18n.t('loading_dxf') || 'Loading CAD…');
    window.api.send('copy-file', { src: file, dst: dst }, function(copied) {
        if (!copied) {
            alert("Couldn't copy CAD file");
            finish(null);
            return;
        }
        window.api.send('import-dxf', { file: dst, out: outJson }, function(r) {
            if (r && r.error) {
                alert(r.error);
                finish(null);
                return;
            }
            let applyMeta = function(contours, bounds) {
                try {
                    project.dxf_original = file;
                    project.contour_file = outJson;
                    project.contours = contours || [];
                    if (!project.contours.length) {
                        alert(i18n.t('err_dxf_empty') || 'No supported entities found in CAD file.');
                        finish([]);
                        return;
                    }
                    if (!project.applyCadBounds(bounds, project.contours) && !project.stl) {
                        alert(i18n.t('err_dxf_empty') || 'CAD bounds are empty.');
                        finish(null);
                        return;
                    }
                    project.dirty = true;
                    finish(project.contours);
                } catch (e) {
                    alert(String(e));
                    finish(null);
                }
            };
            if (r && r.contours) {
                applyMeta(r.contours, r.bounds);
                return;
            }
            let jsonPath = (r && r.file) || outJson;
            window.api.send('read-file', jsonPath, function(text) {
                try {
                    let meta = JSON.parse(text || '{}');
                    applyMeta(meta.contours, meta.bounds || (r && r.bounds));
                } catch (e) {
                    alert(String(e));
                    finish(null);
                }
            });
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
            project.stl_cam = scaledfile;
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
        stl: this.stl_cam || this.stl,
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
    var job = this.jobs[id];
    var offset = {
        x: this.mesh.min.x-this.mesh.origin.x,
        y: this.mesh.min.y-this.mesh.origin.y,
        z: this.mesh.max.z-this.mesh.origin.z,
    };
    if (this.rotary) {
        offset.y = 0;
        offset.z = 0;
    }

    var gcodepath = this.workingDir() + "/job-" + id + ".gcode";
    var write_stock = this.workingDir() + "/job-" + id + ".png";
    var read_stock = (id > 0 ? this.jobs[id-1].outputheightmap : null);

    var finish = function(r) {
        if (r.error) {
            alert(r.error);
        }
        if (!r.file) {
            cb(null);
            return;
        }
        // Always re-estimate from final G-code (pngcam time is lost/zero after
        // angled post-processing, and client-side estimate matches clipped paths).
        window.api.send('read-file', r.file, function(rr) {
            let est = 0;
            if (!rr.err && rr.data) {
                let maxvel = (typeof Settings !== 'undefined' && Settings.maxvel) ? Settings.maxvel : 4000;
                est = estimateGcodeCycleTime(rr.data, job.controller.xyfeed, job.controller.zfeed, maxvel);
            }
            project.jobs[id].dirty = false;
            project.dirtyJob(id+1);
            project.jobs[id].gcodefile = r.file;
            project.jobs[id].outputheightmap = r.heightmap_file;
            project.jobs[id].cycletime = (est > 0) ? est : (r.cycletime || 0);
            cb(r.file);
        });
    };

    var sendGenerate = function(heightmap, width, height, off, routeJob, after) {
        let j = JSON.parse(JSON.stringify(routeJob));
        // Ensure percent-based stepover is converted to mm for pngcam
        if (j.path.stepover_percent != null && j.tool.diameter > 0)
            j.path.stepover = j.tool.diameter * j.path.stepover_percent / 100;
        window.api.send('generate-toolpath', {
            job: j,
            heightmap: heightmap,
            width: width,
            height: height,
            depth: project.mesh.depth,
            offset: off,
            imperial: project.imperial,
            write_stock: write_stock,
            read_stock: read_stock,
            gcodepath: gcodepath,
            rotary: project.rotary,
        }, after);
    };

    // Contour strategies: outside / inside profile, pocket.
    let contourDirs = {
        'contour-outside': 1,
        'contour-inside': 1,
        'contour-pocket': 1,
    };
    if (!this.rotary && contourDirs[job.path.direction]) {
        let contourFile = null;
        let writeContour = this.workingDir() + "/job-" + id + "-contour.json";
        let src = job.path.contour_source || 'heightmap';
        let finishContour = function(contourPath) {
            window.api.send('generate-toolpath', {
                job: JSON.parse(JSON.stringify(job)),
                heightmap: project.heightmap,
                contour_file: contourPath,
                write_contour: writeContour,
                width: project.mesh.width,
                height: project.mesh.height,
                depth: project.mesh.depth,
                offset: offset,
                imperial: project.imperial,
                write_stock: write_stock,
                gcodepath: gcodepath,
                rotary: false,
            }, finish);
        };
        if (src === 'dxf' || (typeof src === 'string' && src.indexOf('dxf:') === 0)) {
            let cid = job.path.contour_id;
            if (src.indexOf('dxf:') === 0)
                cid = parseInt(src.split(':')[1], 10);
            let c = null;
            for (let i = 0; i < (project.contours || []).length; i++) {
                if (project.contours[i].id === cid || i === cid) {
                    c = project.contours[i];
                    break;
                }
            }
            if (!c || !c.closed) {
                alert(i18n.t('err_contour_dxf'));
                cb(null);
                return;
            }
            contourFile = project.workingDir() + "/contour-sel.json";
            window.api.send('write-file', {
                file: contourFile,
                data: JSON.stringify({
                    source: 'dxf',
                    points: c.points,
                    name: c.name,
                }),
            }, function() {
                finishContour(contourFile);
            });
            return;
        }
        if (!this.heightmap) {
            alert(i18n.t('err_heightmap_size'));
            cb(null);
            return;
        }
        finishContour(null);
        return;
    }

    // Angled raster: full pipeline in main process (rotate → pngcam → unrotate).
    let useAngle = (!this.rotary && job.path.direction === 'angle');
    let angleDeg = parseFloat(job.path.angle);
    if (useAngle && isFinite(angleDeg) && Math.abs(((angleDeg % 180) + 180) % 180) > 0.01
        && Math.abs((((angleDeg % 180) + 180) % 180) - 90) > 0.01) {
        if (!this.heightmap) {
            alert(i18n.t('err_heightmap_size'));
            cb(null);
            return;
        }
        // Prefer explicit stock box; fall back to model AABB (origin-relative)
        let stockBounds = null;
        if (typeof getStockBoundsOriginRelative === 'function')
            stockBounds = getStockBoundsOriginRelative(project);
        if (!stockBounds || !(stockBounds.xmax > stockBounds.xmin)) {
            stockBounds = {
                xmin: +project.mesh.min.x - +project.mesh.origin.x,
                xmax: +project.mesh.max.x - +project.mesh.origin.x,
                ymin: +project.mesh.min.y - +project.mesh.origin.y,
                ymax: +project.mesh.max.y - +project.mesh.origin.y,
            };
        }
        // Plain numbers only — THREE.Vector3 does not always survive IPC intact
        let meshPlain = {
            min: { x: +project.mesh.min.x, y: +project.mesh.min.y, z: +project.mesh.min.z },
            max: { x: +project.mesh.max.x, y: +project.mesh.max.y, z: +project.mesh.max.z },
        };
        let originPlain = {
            x: +project.mesh.origin.x,
            y: +project.mesh.origin.y,
            z: +project.mesh.origin.z,
        };
        let hmW = Math.ceil(project.mesh.width / project.resolution);
        let hmH = Math.ceil(project.mesh.height / project.resolution);
        let depth = +project.mesh.depth;
        if (!(depth > 0)) depth = +project.mesh.lineardepth || (meshPlain.max.z - meshPlain.min.z);

        // Ensure stepover mm is set before IPC
        let jobCopy = JSON.parse(JSON.stringify(job));
        if (jobCopy.path.stepover_percent != null && jobCopy.tool.diameter > 0)
            jobCopy.path.stepover = jobCopy.tool.diameter * jobCopy.path.stepover_percent / 100;

        window.api.send('generate-angled-toolpath', {
            job: jobCopy,
            heightmap: this.heightmap,
            rotatedFile: this.workingDir() + "/job-" + id + "-angled.png",
            rotatedStockFile: this.workingDir() + "/job-" + id + "-angled-stock.png",
            angleDeg: angleDeg,
            resolution: +this.resolution || 0.5,
            mesh: meshPlain,
            origin: originPlain,
            stockBounds: stockBounds,
            depth: depth,
            offsetZ: +offset.z,
            imperial: !!project.imperial,
            write_stock: write_stock,
            read_stock: read_stock,
            gcodepath: gcodepath,
            stockOutW: hmW,
            stockOutH: hmH,
        }, function(r) {
            finish(r || { error: i18n.t('err_angled_failed') });
        });
        return;
    }

    // 0° / 90° angle aliases
    if (useAngle) {
        let a = ((angleDeg % 180) + 180) % 180;
        let alias = JSON.parse(JSON.stringify(job));
        alias.path.direction = (Math.abs(a - 90) < 0.01) ? 'vertical' : 'horizontal';
        sendGenerate(this.heightmap, this.mesh.width, this.mesh.height, offset, alias, finish);
        return;
    }

    sendGenerate(this.heightmap, this.mesh.width, this.mesh.height, offset, job, finish);
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
        throw "illegal xy origin: " + this.xyorigin;
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
        throw "illegal z origin: " + this.zorigin;
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
