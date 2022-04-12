var currentjob = null;
var project = new Project();
var progresspct;
var progresstarget;
var progressstarted;

var LARGE_HEIGHTMAP_PX = 4e6; // how many pixels for large heightmap warning?

function showHeightmap(file) {
    var width = project.mesh.width;
    var height = project.mesh.height;
    var depth = project.mesh.depth;
    HeightmapViewer(file, width, height, depth, project.mesh.min.x-scenemiddle.x, project.mesh.min.y-scenemiddle.y, project.mesh.min.z-scenemiddle.z);
}

function timefmt(millis) {
    // TODO: hours, minutes, etc.
    return (1+Math.round(millis/1000)) + " secs";
}

function progress(pct) {
    $(`#${progresstarget}-pct`).val(pct);
    if (pct == null) {
        $(`#${progresstarget}-pct`).hide();
    } else {
        $(`#${progresstarget}-pct`).show();
    }
    progresspct = pct;

    progressEta();
}

function progressEta() {
    let pct = progresspct;
    if (progressstarted) {
        if (pct > 0) {
            let howlong = Date.now()-progressstarted;
            let howmuch = pct/100;
            let timefor100 = howlong/howmuch;
            let remaining = timefor100 - howlong;
            $(`#${progresstarget}-eta`).text("ETA: " + timefmt(remaining));
        } else {
            $(`#${progresstarget}-eta`).text("ETA: ?");
        }
    } else {
        $(`#${progresstarget}-eta`).text("");
    }
}
window.api.receiveAll('progress', progress);

window.setInterval(progressEta, 1000);

function progressStart() {
    progressstarted = Date.now();
    progress(0);
    $(`#${progresstarget}-cancel`).show();
}

function progressEnd() {
    progressstarted = null;
    progress(null);
    $(`#${progresstarget}-cancel`).hide();
}

function cancelProcessing() {
    window.api.send('cancel');
}

$('#model-cancel').click(cancelProcessing);
$('#toolpath-cancel').click(cancelProcessing);

/* model tab */

function showModel() {
    currentjob = null;
    $('#model-options').show();
    $('#toolpath-options').hide();

    $('#resolution').val(project.resolution);

    progresstarget = 'model';
    progress(null);

    updateModel();
    redrawTabs();
}

function loadSTL() {
    project.loadSTL($('#stlfile')[0].files[0].path, updateModel);
    STLViewer(project.stl);
}

function updateModel() {
    $('#heightmapwarning').hide();
    if (project.mesh.width == null) {
        $('#heightmapsize').text('?');
    } else {
        var w = Math.round(project.mesh.width / project.resolution);
        var h = Math.round(project.mesh.height / project.resolution);
        $('#heightmapsize').text(`${w}x${h}`);
        if (w*h > LARGE_HEIGHTMAP_PX) $('#heightmapwarning').show();
    }

    var fmt = function(f) {
        return Math.round(f*100)/100;
    }

    if (project.mesh.width == null) {
        $('#bounds').html('X:<br>Y:<br>Z:<br>');
    } else {
        $('#bounds').html(`X: ${fmt(project.mesh.min.x)} to ${fmt(project.mesh.max.x)} (${fmt(project.mesh.width)})<br>Y: ${fmt(project.mesh.min.y)} to ${fmt(project.mesh.max.y)} (${fmt(project.mesh.height)})<br>Z: ${fmt(project.mesh.min.z)} to ${fmt(project.mesh.max.z)} (${fmt(project.mesh.depth)})`);
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
    progress(null);

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
}

$('#generate-toolpath').click(function() {
    progressStart();
    project.generateToolpath(currentjob, function(file) {
        progressEnd();
        if (file)
            ToolpathViewer(file);
    });
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
    $('#jobtabs').append(`<button class="tab" id="job-${id}-tab">JOB ${id+1}</button>`);
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

showModel();
