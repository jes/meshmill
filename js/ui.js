var currentjob = null;
var project;

var LARGE_HEIGHTMAP_PX = 500e3; // how many pixels for large heightmap warning?
var MANY_TRIANGLES = 10e6; // how many triangles for a triangle count warning?

function showHeightmap(file, cb) {
    var width = project.mesh.width;
    var height = project.mesh.height;
    var depth = project.mesh.depth;

    HeightmapViewer(file, {
        x:width, y:height, z:depth, // size
    }, { // offset
        x: project.mesh.min.x,
        y: project.mesh.min.y,
        z: project.mesh.min.z,
    },
    project.mesh.origin,
    cb);
}

function showToolpath(file, heightmapfile) {
    var middlex = (project.mesh.min.x+project.mesh.max.x)/2 - project.mesh.origin.x;
    var middley = (project.mesh.min.y+project.mesh.max.y)/2 - project.mesh.origin.y;
    var middlez = (project.mesh.min.z+project.mesh.max.z)/2 - project.mesh.origin.z;

    showHeightmap(heightmapfile, function() {
        if ($('#show-toolpath').prop('checked')) ToolpathViewer(file, middlex, middley, middlez);
    });
}

function cancelProcessing() {
    window.api.send('cancel');
}

$('#model-cancel').click(cancelProcessing);
$('#toolpath-cancel').click(cancelProcessing);

function updateUnits() {
    if (project.imperial) {
        $('.unit-mm').text('inches');
        $('.unit-mmmin').text('inches/min');
    } else {
        $('.unit-mm').text('mm');
        $('.unit-mmmin').text('mm/min');
    }
}

/* model tab */

function showModel() {
    currentjob = null;
    $('#model-options').show();
    $('#toolpath-options').hide();
    $('#toolpath-scene-controls').hide();

    $('#resolution').val(project.resolution);
    $('#bottomside').prop('checked', project.bottomside);

    progresstarget = 'model';
    progressReset();

    updateModel();
    updateHeightmap();
    updateUnits();
    drawModel();
    redrawTabs();
}

function drawModel() {
    if (project.heightmap) showHeightmap(project.heightmap);
    else if (project.stl) STLViewer(project.stl, project.mesh.origin); // TODO: don't recentre the view unless the model is genuinely new
    else showScene();
}

// TODO: this function is used for both reloading the STL from disk and re-rendering the STL
// at a new origin - these need to be split up eventually because sometimes we want to re-render
// the STL without reloading the original file
function loadSTL(path) {
    project.loadSTL(path, function() {
        updateModel();
        STLViewer(project.stl, project.mesh.origin);
    });
}

function updateModel() {
    $('#heightmapwarning').hide();
    $('#trianglewarning').hide();
    if (project.mesh.width) {
        var w = Math.round(project.mesh.width / project.resolution);
        var h = Math.round(project.mesh.height / project.resolution);
        $('#heightmapsize').text(`${w}x${h}`);
        if (w*h > LARGE_HEIGHTMAP_PX) $('#heightmapwarning').show();

        var fmt = function(f) {
            return formatFloat(f);
        }
        $('#triangles').text(project.mesh.triangles);
        if (project.mesh.triangles > MANY_TRIANGLES) $('#trianglewarning').show();
        $('#bounds').html(`<span style="color:red">X</span>: ${fmt(project.mesh.min.x-project.mesh.origin.x)} to ${fmt(project.mesh.max.x-project.mesh.origin.x)} (${fmt(project.mesh.width)})<br><span style="color:green">Y</span>: ${fmt(project.mesh.min.y-project.mesh.origin.y)} to ${fmt(project.mesh.max.y-project.mesh.origin.y)} (${fmt(project.mesh.height)})<br><span style="color:blue">Z</span>: ${fmt(project.mesh.min.z-project.mesh.origin.z)} to ${fmt(project.mesh.max.z-project.mesh.origin.z)} (${fmt(project.mesh.depth)})`);

        $('#reloadstl').prop("disabled",false);
        $('#render-heightmap').prop("disabled",false);
    } else {
        $('#heightmapsize').text('?');
        $('#triangles').text(0);
        $('#bounds').html('');
        $('#reloadstl').prop("disabled",true);
        $('#render-heightmap').prop("disabled",true);
    }

    updateHeightmap();
}

function updateHeightmap() {
    if (Settings.show_heightmap_2d && project.heightmap) {
        $('#heightmap-img').show();
        $('#heightmap-img').prop("src", project.heightmap + "?" + Math.random()); // XXX: avoid cache
    } else {
        $('#heightmap-img').hide();
    }

    if (project.heightmap) {
        $('#addjob-tab').prop("disabled",false);
    } else {
        $('#addjob-tab').prop("disabled",true);
    }
}

$('#stlfile').change(function() {
    loadSTL($('#stlfile')[0].files[0].path);
    redrawTabs();
});

$('#reloadstl').click(function() {
    if (project.stl_original)
        loadSTL(project.stl_original);
});

$('#xyorigin').change(function() {
    project.setXYOrigin($('#xyorigin').val());
    updateModel();
    drawModel();
});

$('#zorigin').change(function() {
    project.setZOrigin($('#zorigin').val());
    updateModel();
    drawModel();
});

function doRenderHeightmap(cb) {
    progressStart();
    project.renderHeightmap(function(file) {
        progressEnd();
        updateHeightmap();
        if (file)
            showHeightmap(file);
        redrawTabs();
        if (cb) cb(file);
    });
}

$('#render-heightmap').click(function() {
    doRenderHeightmap();
});

$('#resolution').keyup(function() {
    project.dirtyModel();
    project.resolution = parseFloat($('#resolution').val());
    updateModel();
    redrawTabs();
});

$('#bottomside').change(function() {
    project.dirtyModel();
    project.bottomside = $('#bottomside').prop('checked');
    // TODO: redraw the STL upside down
    // TODO: update the bounds to show negative Y (?) values
    updateModel();
    redrawTabs();
});

/* job tab */

function showJob(id) {
    currentjob = id;
    $('#model-options').hide();
    $('#toolpath-options').show();
    $('#toolpath-scene-controls').show();

    let job = project.getJob(id);
    $('#toolshape').val(job.tool.shape);
    $('#tooldiameter').val(job.tool.diameter);
    $('#xyfeed').val(job.controller.xyfeed);
    $('#zfeed').val(job.controller.zfeed);
    $('#safez').val(job.controller.safez);
    $('#rpm').val(job.controller.rpm);
    $('#direction').val(job.path.direction);
    $('#stepover').val(job.path.stepover);
    $('#stepforward').val(job.path.stepforward);
    $('#stepdown').val(job.path.stepdown);
    $('#clearance').val(job.path.clearance);

    $('#roughingonly').prop('checked', job.path.roughingonly);
    $('#rampentry').prop('checked', job.path.rampentry);
    $('#omittop').prop('checked', job.path.omittop);
    $('#clearbottom').prop('checked', job.path.clearbottom);
    $('#clearedges').prop('checked', job.path.clearedges);

    if (job.cycletime !== null) {
        $('#cycletime').text(timefmt(job.cycletime*1000));
    } else {
        $('#cycletime').text("?");
    }

    progresstarget = 'toolpath';
    progressReset();

    updateJob();
    updateUnits();
    drawJob();
    redrawTabs();
}

function drawJob() {
    if (project.jobs[currentjob].gcodefile) showToolpath(project.jobs[currentjob].gcodefile, project.jobs[currentjob].outputheightmap);
    else drawModel();
}

function updateJob() {
    let j = project.jobs[currentjob];
    j.tool.shape = $('#toolshape').val();
    j.tool.diameter = parseFloat($('#tooldiameter').val());
    j.controller.xyfeed = parseFloat($('#xyfeed').val());
    j.controller.zfeed = parseFloat($('#zfeed').val());
    j.controller.safez = parseFloat($('#safez').val());
    j.controller.rpm = parseFloat($('#rpm').val());
    j.path.direction = $('#direction').val();
    j.path.stepover = parseFloat($('#stepover').val());
    j.path.stepforward = parseFloat($('#stepforward').val());
    j.path.stepdown = parseFloat($('#stepdown').val());
    j.path.clearance = parseFloat($('#clearance').val());
    j.path.roughingonly = $('#roughingonly').prop('checked');
    j.path.rampentry = $('#rampentry').prop('checked');
    j.path.omittop = $('#omittop').prop('checked');
    j.path.clearbottom = $('#clearbottom').prop('checked');
    j.path.clearedges = $('#clearedges').prop('checked');

    if (j.path.stepover > j.tool.diameter) {
        $('#surfacedeviation').html("&infin;");
    } else {
        let r = j.tool.diameter/2;
        let x = j.path.stepover/2;
        let dev = r - Math.sqrt(r*r - x*x);
        $('#surfacedeviation').text(formatFloat(dev));
    }

    if (project.heightmap) {
        $('#generate-toolpath').prop("disabled", false);
    } else {
        $('#generate-toolpath').prop("disabled", true);
    }

    if (j.gcodefile) {
        $('#save-gcode').prop("disabled", false);
    } else {
        $('#save-gcode').prop("disabled", true);
    }

    if (j.path.stepover > j.tool.diameter) {
        $('#stepoverwarning').show();
    } else {
        $('#stepoverwarning').hide();
    }

    if (j.path.stepforward < project.resolution) {
        $('#stepforwardwarning').show();
    } else {
        $('#stepforwardwarning').hide();
    }
}

function doGenerateToolpath(cb) {
    progressStart();
    project.generateToolpath(currentjob, function(file) {
        progressEnd();
        showJob(currentjob);
        updateJob();
        drawJob();
        redrawTabs();
        if (cb) cb(file);
    });
}

$('#generate-toolpath').click(function() {
    if (!project.jobReady(currentjob-1)) {
        confirmDialog("Unprocessed changes may affect this job. Generate the toolpath anyway?", "Generate toolpath", "Cancel", function(confirmed) {
            if (confirmed)
                doGenerateToolpath();
        });
    } else {
        doGenerateToolpath();
    }
});

$('#save-gcode').click(function() {
    if (!project.jobReady(currentjob)) {
        confirmDialog("Unprocessed changes may affect this job. Save the existing G-code anyway?", "Save G-code", "Cancel", function(confirmed) {
            if (confirmed)
                project.saveGcode(currentjob);
        });
    } else {
        project.saveGcode(currentjob);
    }
});

$('#deletejob').click(function() {
    project.dirtyJob(currentjob+1);
    project.deleteJob(currentjob);
    deleteJobTab(project.jobs.length);
    if (currentjob >= project.jobs.length) currentjob--;
    if (project.jobs.length > 0) {
        showJob(currentjob);
    } else {
        showModel();
    }
});

$('#show-toolpath').change(drawJob);

function inputJob() {
    project.dirtyJob(currentjob);
    redrawTabs();
    updateJob();
}

var inputs = ['toolshape', 'tooldiameter', 'xyfeed', 'zfeed', 'safez', 'rpm', 'direction', 'stepover', 'stepforward', 'stepdown', 'clearance', 'roughingonly', 'rampentry', 'omittop', 'clearbottom', 'clearedges'];
for (var i = 0; i < inputs.length; i++) {
    $('#' + inputs[i]).change(inputJob);
    $('#' + inputs[i]).keyup(inputJob);
}

/* tabs */

function addJobTab(id) {
    $('#jobtabs').append(`<button class="tab" id="job-${id}-tab"><img class="dirty" src="img/refresh.svg">JOB ${id+1}</button>`);
    $(`#job-${id}-tab`).click(function() {
        showJob(id);
    });
}

function deleteJobTab(id) {
    $(`#job-${id}-tab`).remove();
    redrawTabs();
}

function redrawTabs() {
    onWindowResize();

    if (currentjob == null) {
        $('#model-tab').addClass('tab-active');
    } else {
        $('#model-tab').removeClass('tab-active');
    }
    if (project.dirty_model) {
        $(`#model-tab`).addClass('tab-dirty');
    } else {
        $(`#model-tab`).removeClass('tab-dirty');
    }

    for (var i = 0; i < project.jobs.length; i++) {
        if (i == currentjob) {
            $(`#job-${i}-tab`).addClass('tab-active');
        } else {
            $(`#job-${i}-tab`).removeClass('tab-active');
        }

        if (project.jobs[i].dirty) {
            $(`#job-${i}-tab`).addClass('tab-dirty');
        } else {
            $(`#job-${i}-tab`).removeClass('tab-dirty');
        }
    }
}

$('#model-tab').click(function() {
    showModel();
});

$('#addjob-tab').click(function() {
    let id = project.addJob();
    addJobTab(id);
    showJob(id);
});

/* menu actions */

window.api.receive('new-project', function() {
    if (project && project.dirty) {
        confirmDialog("Project unsaved. Are you sure you want a new one?", "New project", "Cancel", function(confirmed) {
            if (confirmed)
                newProject();
        });
    } else {
        newProject();
    }
});

window.api.receive('save-project', function(filename) {
    project.save(filename);
});

window.api.receive('want-open', function() {
    if (project && project.dirty) {
        confirmDialog("Project unsaved. Are you sure you want to open another?", "Open another project", "Cancel", function(confirmed) {
            if (confirmed)
                window.api.send('open-project');
        });
    } else {
        window.api.send('open-project');
    }
});

window.api.receive('open-project', function(filename) {
    openProject(filename);
});

function openProject(filename) {
    if (filename.toLowerCase().endsWith(".stl")) {
        newProject(function(project) {
            project.loadSTL(filename, showModel);
        });
    } else {
        newProject(function(project) {
            project.open(filename, function() {
                for (var i = 0; i < project.jobs.length; i++)
                    addJobTab(i);
                showModel();
            });
        });
    }
}

function newProject(cb) {
    project = new Project(cb);
    $('#jobtabs').html('');
    showModel();
}
newProject();

var dialogWaiting = false;
function confirmDialog(msg, yes, no, cb) {
    if (dialogWaiting)
        return;

    dialogWaiting = true;
    window.api.send('confirm-dialog', {
        text: msg,
        yes: yes,
        no: no,
    }, function(r) {
        dialogWaiting = false;
        cb(r);
    });
}

window.api.receive('want-close', function() {
    if (project && project.dirty) {
        confirmDialog("Project unsaved. Are you sure you want to quit?", "Quit", "Don't quit", function(confirmed) {
            if (confirmed)
                window.api.send("close");
        });
    } else {
        window.api.send('close');
    }
});

window.api.receive('set-settings', function(s) {
    Settings = s;
    project.imperial = Settings.imperial;
    updateUnits();
    updateHeightmap();
});

window.api.send('get-settings');

function recomputeNext(id, only_dirty) {
    if (only_dirty) {
        for (; !project.jobs[id].dirty; id++);
    }

    if (id >= project.jobs.length) return;

    showJob(id);
    doGenerateToolpath(function(file) {
        if (file) recomputeNext(id+1);
    });
}

window.api.receive('reprocess-all', function() {
    showModel();
    doRenderHeightmap(function(file) {
        if (file) recomputeNext(0);
    });
});

window.api.receive('reprocess-dirty', function() {
    if (project.dirty_model) {
        showModel();
        doRenderHeightmap(function(file) {
            if (file) recomputeNext(0, true);
        });
    } else {
        recomputeNext(0, true);
    }
});
