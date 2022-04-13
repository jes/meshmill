var currentjob = null;
var project;

var LARGE_HEIGHTMAP_PX = 4e6; // how many pixels for large heightmap warning?

function showHeightmap(file) {
    var width = project.mesh.width;
    var height = project.mesh.height;
    var depth = project.mesh.depth;

    var middlex = (project.mesh.min.x+project.mesh.max.x)/2;
    var middley = (project.mesh.min.y+project.mesh.max.y)/2;
    var middlez = (project.mesh.min.z+project.mesh.max.z)/2;

    HeightmapViewer(file, width, height, depth, project.mesh.min.x-middlex, project.mesh.min.y-middley, project.mesh.min.z-middlez);
}

function showToolpath(file) {
    var middlex = (project.mesh.min.x+project.mesh.max.x)/2;
    var middley = (project.mesh.min.y+project.mesh.max.y)/2;
    var middlez = (project.mesh.min.z+project.mesh.max.z)/2;

    ToolpathViewer(file, middlex, middley, middlez);
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
    project.loadSTL($('#stlfile')[0].files[0].path, function() {
        updateModel();
        STLViewer(project.stl);
    });
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
            showToolpath(file);
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
    newProject(function(project) {
        project.open(filename, function() {
            for (var i = 0; i < project.jobs.length; i++)
                addJobTab(i);
            showModel();
            console.log(project);
            if (project.heightmap) showHeightmap(project.heightmap);
            else if (project.stl) STLViewer(project.stl);
        });
    });
}

function newProject(cb) {
    project = new Project(cb);
    $('#jobtabs').html('');
    showModel();
}
newProject();

function confirmDialog(msg, yes, no, cb) {
    window.api.send('confirm-dialog', {
        text: msg,
        yes: yes,
        no: no,
    }, cb);
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
