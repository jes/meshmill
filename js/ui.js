var currentjob;
var project = new Project();

var LARGE_HEIGHTMAP_PX = 4e6; // how many pixels for large heightmap warning?

function showHeightmap(file) {
    var width = project.mesh.width;
    var height = project.mesh.height;
    var depth = project.mesh.depth;
    HeightmapViewer(file, width, height, depth);
}

/* model tab */

function showModel() {
    currentjob = null;
    $('#model-options').show();
    $('#toolpath-options').hide();

    $('#resolution').val(project.resolution);

    updateModel();
    redrawTabs();
}

function loadSTL() {
    project.loadSTL($('#stlfile')[0].files[0].path, updateModel);
    STLViewer(project.stl);
    updateModel();
}

function updateModel() {
    $('#heightmapwarning').hide();
    if (project.mesh.width == null) {
        $('#heightmapsize').text('?');
    } else {
        console.log(project.mesh);
        var w = Math.round(project.mesh.width / project.resolution);
        var h = Math.round(project.mesh.height / project.resolution);
        $('#heightmapsize').text(`${w}x${h}`);
        if (w*h > LARGE_HEIGHTMAP_PX) $('#heightmapwarning').show();
    }
}

$('#stlfile').change(function() {
    loadSTL();
});

$('#reloadstl').click(function() {
    loadSTL();
});

$('#render-heightmap').click(function() {
    project.renderHeightmap(function(file) {
        showHeightmap(file);
    });
});

$('#resolution').keyup(function() {
    project.resolution = parseFloat($('#resolution').val());
    updateModel();
});

/* job tab */

function showJob(id) {
    currentjob = id;
    $('#model-options').hide();
    $('#toolpath-options').show();

    let job = project.getJob(id);
    $('#toolshape').text(job.tool.shape);
    $('#tooldiameter').text(job.tool.diameter);
    $('#xyfeed').text(job.controller.xyfeed);
    $('#zfeed').text(job.controller.zfeed);
    $('#safez').text(job.controller.safez);
    $('#rpm').text(job.controller.rpm);
    $('#direction').text(job.path.direction);
    $('#stepover').text(job.path.stepover);
    $('#stepdown').text(job.path.stepdown);
    $('#clearance').text(job.path.clearance);

    redrawTabs();
}

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
