var currentjob = null;
var project;

var LARGE_HEIGHTMAP_PX = 4e6; // how many pixels for large heightmap warning?

function showHeightmap(file) {
    var width = project.mesh.width;
    var height = project.mesh.height;
    var depth = project.mesh.depth;
    HeightmapViewer(file, width, height, depth, project.mesh.min.x-scenemiddle.x, project.mesh.min.y-scenemiddle.y, project.mesh.min.z-scenemiddle.z);
}

function cancelProcessing() {
    window.api.send('cancel');
}

$('#model-cancel').click(cancelProcessing);
$('#toolpath-cancel').click(cancelProcessing);

function updateUnits() {
    if (Settings.imperial) {
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

    $('#resolution').val(project.resolution);

    progresstarget = 'model';
    progressEnd();

    updateModel();
    updateHeightmap();
    updateUnits();
    redrawTabs();
}

function loadSTL() {
    project.loadSTL($('#stlfile')[0].files[0].path, updateModel);
    STLViewer(project.stl);
}

function updateModel() {
    $('#heightmapwarning').hide();
    if (project.mesh.width) {
        var w = Math.round(project.mesh.width / project.resolution);
        var h = Math.round(project.mesh.height / project.resolution);
        $('#heightmapsize').text(`${w}x${h}`);
        if (w*h > LARGE_HEIGHTMAP_PX) $('#heightmapwarning').show();

        var fmt = function(f) {
            return Math.round(f*100)/100;
        }
        $('#bounds').html(`X: ${fmt(project.mesh.min.x)} to ${fmt(project.mesh.max.x)} (${fmt(project.mesh.width)})<br>Y: ${fmt(project.mesh.min.y)} to ${fmt(project.mesh.max.y)} (${fmt(project.mesh.height)})<br>Z: ${fmt(project.mesh.min.z)} to ${fmt(project.mesh.max.z)} (${fmt(project.mesh.depth)})`);

        $('#reloadstl').prop("disabled",false);
        $('#render-heightmap').prop("disabled",false);
    } else {
        $('#heightmapsize').text('?');
        $('#bounds').html('X:<br>Y:<br>Z:<br>');
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
    loadSTL();
});

$('#reloadstl').click(function() {
    loadSTL();
});

$('#render-heightmap').click(function() {
    progressStart();
    project.renderHeightmap(function(file) {
        progressEnd();
        updateHeightmap();
        if (file)
            showHeightmap(file);
    });
});

$('#resolution').keyup(function() {
    project.resolution = parseFloat($('#resolution').val());
    updateModel();
});

$('#bottomside').change(function() {
    project.bottomside = $('#bottomside').prop('checked');
    // TODO: redraw the STL upside down
    // TODO: update the bounds to show negative Y (?) values
    updateModel();
});

/* job tab */

function showJob(id) {
    currentjob = id;
    $('#model-options').hide();
    $('#toolpath-options').show();

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

    $('#roughingonly').val(job.path.roughingonly);
    $('#rampentry').val(job.path.rampentry);
    $('#omittop').val(job.path.omittop);
    $('#clearbottom').val(job.path.clearbottom);

    progresstarget = 'toolpath';
    progressEnd();

    updateJob();
    updateUnits();
    redrawTabs();
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
    j.path.clearbottom = $('#clearbottom').prop('checked');

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
}

$('#generate-toolpath').click(function() {
    progressStart();
    project.generateToolpath(currentjob, function(file) {
        progressEnd();
        updateJob();
        if (file)
            ToolpathViewer(file);
        // TODO: show cycle time estimate
    });
});

$('#save-gcode').click(function() {
    project.saveGcode(currentjob);
});

$('#deletejob').click(function() {
    project.deleteJob(currentjob);
    deleteJobTab(project.jobs.length);
    if (currentjob >= project.jobs.length) currentjob--;
    if (project.jobs.length > 0) {
        showJob(currentjob);
    } else {
        showModel();
    }
});

var inputs = ['toolshape', 'tooldiameter', 'xyfeed', 'zfeed', 'safez', 'rpm', 'direction', 'stepover', 'stepdown', 'clearance', 'roughingonly', 'rampentry', 'omittop'];
for (var i = 0; i < inputs.length; i++) {
    $('#' + inputs[i]).change(updateJob);
}

/* tabs */

function addJobTab(id) {
    $('#jobtabs').append(`<button class="tab" id="job-${id}-tab">JOB ${id+1}</button><br>`);
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
        $('#model-tab').css('background','red');
    } else {
        $('#model-tab').css('background','');
    }

    for (var i = 0; i < project.jobs.length; i++) {
        if (i == currentjob) {
            $(`#job-${i}-tab`).css('background','red');
        } else {
            $(`#job-${i}-tab`).css('background','');
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

function newProject() {
    // TODO: warn if the project is unsaved
    project = new Project();
    $('#jobtabs').html('');
    showModel();
    showScene();
}
newProject();

/* menu actions */

window.api.receiveAll('new-project', newProject);
