var currentjob = null;
var project;

var LARGE_HEIGHTMAP_PX = 500e3; // how many pixels for large heightmap warning?
var MANY_TRIANGLES = 1e6; // how many triangles for a triangle count warning?

var EPSILON = 0.000001; // for floating point comparison with 0

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
    project.rotary,
    cb);
}

function showToolpath(file, heightmapfile, rotary, toolradius) {
    var middlex = (project.mesh.min.x+project.mesh.max.x)/2 - project.mesh.origin.x;
    var middley = (project.mesh.min.y+project.mesh.max.y)/2 - project.mesh.origin.y;
    var middlez = (project.mesh.min.z+project.mesh.max.z)/2 - project.mesh.origin.z;

    if (rotary) {
        middley = 0;
        middlez = 0;
    }

    showHeightmap(heightmapfile, function() {
        if ($('#show-toolpath').prop('checked')) ToolpathViewer(file, middlex, middley, middlez, toolradius);
    });
}

function showBusy(text) {
    $('#busy-text').text(text || '');
    $('#busy-overlay').show();
}

function hideBusy() {
    $('#busy-overlay').hide();
}

function cancelProcessing() {
    window.api.send('cancel');
}

$('#model-cancel').click(cancelProcessing);
$('#toolpath-cancel').click(cancelProcessing);

function updateUnits() {
    if (project.imperial) {
        $('.unit-mm').text(i18n.t('unit_inch'));
        $('.unit-mmmin').text(i18n.t('unit_inchmin'));
    } else {
        $('.unit-mm').text(i18n.t('unit_mm'));
        $('.unit-mmmin').text(i18n.t('unit_mmmin'));
    }
}

/* model tab */

function showModel() {
    currentjob = null;
    $('#model-options').show();
    $('#toolpath-options').hide();
    $('#toolpath-scene-controls').hide();

    $('#xyorigin').val(project.xyorigin);
    $('#zorigin').val(project.zorigin);

    $('#resolution').val(project.resolution);
    $('#rotary').prop('checked', project.rotary);
    $('#bottomside').prop('checked', project.bottomside);

    if (project.stock) {
        $('#stockx').val(project.stock.x);
        $('#stocky').val(project.stock.y);
        $('#stockz').val(project.stock.z);
    }
    $('#scalelock').prop('checked', project.scalelock);
    $('#scalepercent').val(project.scalepercent);

    $('#heightmap-lightbox').hide();
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

function loadSTL(path) {
    project.loadSTL(path, function() {
        updateModel();
        STLViewer(project.stl, project.mesh.origin, true);
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
        $('#show-2d').show();
    } else {
        $('#show-2d').hide();
        $('#heightmap-lightbox').hide();
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
    redrawTabs();
});

$('#zorigin').change(function() {
    project.setZOrigin($('#zorigin').val());
    updateModel();
    drawModel();
    redrawTabs();
});

function doRenderHeightmap(cb) {
    if (project.resolution < 0) project.resolution = -project.resolution;
    showModel();

    let errors = [];
    if (project.resolution < EPSILON) errors.push(i18n.t('err_xy_resolution'));
    var w = Math.round(project.mesh.width / project.resolution);
    var h = Math.round(project.mesh.height / project.resolution);
    if (w < 1 || h < 1) errors.push(i18n.t('err_heightmap_size'));

    if (errors.length) {
        alert(errors.join(" "));
        return;
    }

    progressStart();
    project.renderHeightmap(function(file) {
        progressEnd();
        updateHeightmap();
        if (file) {
            // The heightmap mesh is built synchronously; let the busy overlay
            // paint first so the user sees that work is still in progress.
            showBusy(i18n.t('stage_building_preview'));
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    showHeightmap(file);
                    hideBusy();
                    redrawTabs();
                    if (cb) cb(file);
                });
            });
        } else {
            redrawTabs();
            if (cb) cb(file);
        }
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

$('#rotary').change(function() {
    project.dirtyModel();
    project.setRotary($('#rotary').prop('checked'));
    // TODO: anything?
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

$('#apply-stock').click(function() {
    let sx = parseFloat($('#stockx').val());
    let sy = parseFloat($('#stocky').val());
    let sz = parseFloat($('#stockz').val());
    if (!(sx > 0 && sy > 0 && sz > 0))
        return;
    project.stock = { x: sx, y: sy, z: sz };
    showStockBox(sx, sy, sz);
});

$('#apply-scale').click(function() {
    if (!project.mesh.width) return;

    let stockx = parseFloat($('#stockx').val());
    let stocky = parseFloat($('#stocky').val());
    let stockz = parseFloat($('#stockz').val());
    let pct = parseFloat($('#scalepercent').val());

    project.stock = { x: stockx, y: stocky, z: stockz };
    project.scalelock = $('#scalelock').prop('checked');
    project.scalepercent = pct;

    let sx = 1, sy = 1, sz = 1;
    if (stockx > 0 && stocky > 0 && stockz > 0) {
        let fx = stockx / project.mesh.width;
        let fy = stocky / project.mesh.height;
        let fz = stockz / project.mesh.depth;
        if (project.scalelock) {
            sx = sy = sz = Math.min(fx, fy, fz);
        } else {
            sx = fx; sy = fy; sz = fz;
        }
    } else if (pct > 0) {
        sx = sy = sz = pct / 100;
    } else {
        return;
    }

    project.scaleSTL(sx, sy, sz, function() {
        updateModel();
        drawModel();
        redrawTabs();
    });
});

$('#reset-scale').click(function() {
    if (project.stl_original) {
        loadSTL(project.stl_original);
        redrawTabs();
    }
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
    $('#stepdown').val(job.path.stepdown);
    $('#clearance').val(job.path.clearance);

    $('#roughingonly').prop('checked', job.path.roughingonly);
    $('#rampentry').prop('checked', job.path.rampentry);
    $('#omittop').prop('checked', job.path.omittop);
    $('#omitbottom').prop('checked', job.path.omitbottom);
    $('#clearbottom').prop('checked', job.path.clearbottom);
    $('#clearedges').prop('checked', job.path.clearedges);

    if (job.cycletime != null) {
        $('#cycletime').text(timefmt(job.cycletime*1000));
    } else {
        $('#cycletime').text("?");
    }

    $('#heightmap-lightbox').hide();
    progresstarget = 'toolpath';
    progressReset();

    updateJob();
    updateUnits();
    drawJob();
    redrawTabs();
}

function drawJob() {
    if (project.jobs[currentjob].gcodefile) showToolpath(project.jobs[currentjob].gcodefile, project.jobs[currentjob].outputheightmap, project.rotary, project.jobs[currentjob].tool.diameter/2);
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
    j.path.stepdown = parseFloat($('#stepdown').val());
    j.path.clearance = parseFloat($('#clearance').val());
    j.path.roughingonly = $('#roughingonly').prop('checked');
    j.path.rampentry = $('#rampentry').prop('checked');
    j.path.omittop = $('#omittop').prop('checked');
    j.path.omitbottom = $('#omitbottom').prop('checked');
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

    if (j.controller.safez < 0) {
        $('#safezwarning').show();
    } else {
        $('#safezwarning').hide();
    }

    if (j.path.clearance < 0) {
        $('#clearancewarning').show();
    } else {
        $('#clearancewarning').hide();
    }
}

function doGenerateToolpath(cb) {
    let j = project.jobs[currentjob];
    if (j.tool.diameter < 0) j.tool.diameter = -j.tool.diameter;
    if (j.path.stepover < 0) j.path.stepover = -j.path.stepover;
    if (j.path.stepdown < 0) j.path.stepdown = -j.path.stepdown;
    if (j.controller.xyfeed < 0) j.controller.xyfeed = -j.controller.xyfeed;
    if (j.controller.zfeed < 0) j.controller.zfeed = -j.controller.zfeed;
    showJob(currentjob);

    var errors = [];
    if (j.path.stepover < EPSILON) errors.push(i18n.t('err_stepover'));
    if (j.path.stepdown < EPSILON) errors.push(i18n.t('err_stepdown'));

    if (errors.length) {
        alert(errors.join(" "));
        return;
    }

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
        confirmDialog(i18n.t('confirm_unprocessed_toolpath'), i18n.t('generate_toolpath'), i18n.t('btn_cancel'), function(confirmed) {
            if (confirmed)
                doGenerateToolpath();
        });
    } else {
        doGenerateToolpath();
    }
});

$('#save-gcode').click(function() {
    if (!project.jobReady(currentjob)) {
        confirmDialog(i18n.t('confirm_unprocessed_gcode'), i18n.t('save_gcode'), i18n.t('btn_cancel'), function(confirmed) {
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

$('#duplicatejob').click(function() {
    let id = project.duplicateJob(currentjob);
    $('#jobtabs').html('');
    for (let i = 0; i < project.jobs.length; i++)
        addJobTab(i);
    showJob(id);
});

$('#show-toolpath').change(drawJob);
$('#fitview').click(fitView);

$('.subtab').click(function() {
    let target = $(this).data('target');
    let bar = $(this).closest('.subtabs');
    bar.find('.subtab').removeClass('subtab-active');
    $(this).addClass('subtab-active');
    let container = bar.parent();
    container.find('.subpanel').hide();
    container.find(target).show();
});

$('#show-2d').click(function() {
    if (!project.heightmap) return;
    $('#heightmap-img').prop('src', project.heightmap + '?' + Math.random());
    $('#heightmap-lightbox').show();
});

$('#heightmap-lightbox').click(function() {
    $(this).hide();
});

$('#simulate').click(function() {
    if (stockRunning) {
        stopMaterialSimulation();
    } else if (!startMaterialSimulation()) {
        if (simPlaying) {
            simStop();
        } else {
            simStart();
        }
    }
});

window.updateSimButton = function() {
    let button = $('#simulate');
    if (!button.length) return;
    button.text((stockRunning || simPlaying) ? i18n.t('sim_stop') : i18n.t('simulate'));
};

function inputJob() {
    project.dirtyJob(currentjob);
    redrawTabs();
    updateJob();
}

var inputs = ['toolshape', 'tooldiameter', 'xyfeed', 'zfeed', 'safez', 'rpm', 'direction', 'stepover', 'stepdown', 'clearance', 'roughingonly', 'rampentry', 'omittop', 'omitbottom', 'clearbottom', 'clearedges'];
for (var i = 0; i < inputs.length; i++) {
    $('#' + inputs[i]).change(inputJob);
    $('#' + inputs[i]).keyup(inputJob);
}

/* tabs */

function addJobTab(id) {
    $('#jobtabs').append(`<button class="tab" id="job-${id}-tab"><img class="dirty" src="img/refresh.svg">${i18n.t('job_tab', id+1)}</button>`);
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

/* tool presets */

function getPresets() {
    try {
        return JSON.parse(localStorage.getItem('meshmill.presets') || '[]');
    } catch (err) {
        return [];
    }
}

function savePresets(presets) {
    try {
        localStorage.setItem('meshmill.presets', JSON.stringify(presets));
    } catch (err) {
        // ignore storage errors
    }
}

function refreshPresets(selected) {
    let sel = $('#presetselect');
    sel.html('');
    sel.append($('<option>').val('').text(i18n.t('preset_none')));
    let presets = getPresets();
    for (let i = 0; i < presets.length; i++) {
        sel.append($('<option>').val(i).text(presets[i].name));
    }
    if (selected !== undefined) sel.val(selected);
}

$('#presetsave').click(function() {
    if (currentjob == null) return;
    let name = prompt(i18n.t('preset_prompt_name'), '');
    if (!name) return;
    let job = project.jobs[currentjob];
    let presets = getPresets();
    presets.push({
        name: name,
        tool: JSON.parse(JSON.stringify(job.tool)),
        controller: JSON.parse(JSON.stringify(job.controller)),
        path: JSON.parse(JSON.stringify(job.path)),
    });
    savePresets(presets);
    refreshPresets(presets.length-1);
});

$('#presetdelete').click(function() {
    let idx = parseInt($('#presetselect').val());
    if (isNaN(idx)) return;
    let presets = getPresets();
    presets.splice(idx, 1);
    savePresets(presets);
    refreshPresets();
    if (window.updateSimButton) window.updateSimButton(simPlaying);
});

$('#presetselect').change(function() {
    let idx = parseInt($(this).val());
    if (isNaN(idx) || currentjob == null) return;
    let presets = getPresets();
    let preset = presets[idx];
    if (!preset) return;
    let job = project.jobs[currentjob];
    job.tool = JSON.parse(JSON.stringify(preset.tool));
    job.controller = JSON.parse(JSON.stringify(preset.controller));
    job.path = JSON.parse(JSON.stringify(preset.path));
    project.dirtyJob(currentjob);
    showJob(currentjob);
    updateJob();
    redrawTabs();
});

refreshPresets();

/* menu actions */

window.api.receive('new-project', function() {
    if (project && project.dirty) {
        confirmDialog(i18n.t('confirm_unsaved_new'), i18n.t('btn_new_project'), i18n.t('btn_cancel'), function(confirmed) {
            if (confirmed)
                newProject();
        });
    } else {
        newProject();
    }
});

window.api.receive('save-project', function(filename) {
    $('*').addClass('busy');
    project.ui.scenemiddle = scenemiddle;
    project.save(filename, function() {
        setTimeout(function() {
            $('*').removeClass('busy');
        }, 100);
    });
});

window.api.receive('want-open', function() {
    if (project && project.dirty) {
        confirmDialog(i18n.t('confirm_unsaved_open'), i18n.t('btn_open_another'), i18n.t('btn_cancel'), function(confirmed) {
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
                scenemiddle = project.ui.scenemiddle;
                for (var i = 0; i < project.jobs.length; i++)
                    addJobTab(i);
                showModel();
            });
        });
    }
}

function newProject(cb) {
    camera = null;
    project = new Project(cb);
    $('#jobtabs').html('');
    $('#stlfile').val('');
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
        confirmDialog(i18n.t('confirm_unsaved_quit'), i18n.t('btn_quit'), i18n.t('btn_dont_quit'), function(confirmed) {
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
    i18n.setLang(Settings.lang || 'ru');
    i18n.apply(document);
    updateUnits();
    updateHeightmap();
    refreshPresets();
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
    if (!project.mesh.width) return;
    showModel();
    doRenderHeightmap(function(file) {
        if (file) recomputeNext(0);
    });
});

window.api.receive('reprocess-dirty', function() {
    if (!project.mesh.width) return;
    if (project.dirty_model) {
        showModel();
        doRenderHeightmap(function(file) {
            if (file) recomputeNext(0, true);
        });
    } else {
        recomputeNext(0, true);
    }
});
