var currentjob;
var project = new Project();

function showModel() {
    currentjob = null;
    $('#model-options').show();
    $('#toolpath-options').hide();

    redrawTabs();
}

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

function addJobTab(id) {
    $('#jobtabs').append('<button class="tab" id="job-' + id + '-tab">JOB ' + (id+1) + '</button>');
    $('#job-' + id + '-tab').click(function() {
        showJob(id);
    });
}

function deleteJobTab(id) {
    $('#job-' + id + '-tab').remove();
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
            $('#job-' + i + '-tab').css('background','red');
        } else {
            $('#job-' + i + '-tab').css('background','');
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
