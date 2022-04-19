var progresspct;
var progresstarget;
var progressstarted;
var progressstate;

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
            if (remaining < 0) remaining = 0;
            $(`#${progresstarget}-eta`).text("ETA: " + timefmt(1000+remaining));
        } else {
            $(`#${progresstarget}-eta`).text("ETA: ?");
        }
    } else {
        $(`#${progresstarget}-eta`).text("");
    }
}
window.api.receive('progress', progress);

window.setInterval(progressEta, 1000);

function progressStart() {
    // remember which inputs were disabled, and disable them all
    var inputs = $('button, input, select');
    progressstate = {};
    for (var i = 0; i < inputs.length; i++) {
        progressstate[inputs[i].id] = inputs[i].disabled;
        inputs[i].disabled = true;
    }

    progressstarted = Date.now();
    progress(0);
    $(`#${progresstarget}-cancel`).show();
    $(`#${progresstarget}-cancel`).prop("disabled",false);
}

function progressEnd() {
    // enable the inputs that were previously enabled
    for (const id in progressstate) {
        $('#' + id).prop('disabled', progressstate[id]);
    }

    progressstarted = null;
    progress(null);
    $(`#${progresstarget}-cancel`).hide();
}

function progressReset() {
    progressstate = {};
    progressEnd();
}
