var progresspct;
var progresstarget;
var progressstarted;
var progressstate;
var progressactive = false;

function stageLabel(stage) {
    if (!stage) return "";
    let key = "stage_" + stage.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    let label = i18n.t(key);
    return label === key ? stage : label;
}

function progress(arg) {
    let pct = arg;
    let stage = null;
    if (arg && typeof arg === "object") {
        pct = arg.pct;
        stage = arg.stage;
    }
    if (!progressactive && pct !== null)
        return;
    let label = $(`#${progresstarget}-stage`);
    if (stage) label.text(stageLabel(stage) + (pct !== null ? `: ${pct}%` : ""));
    else if (pct === null) label.text("");
    $(`#${progresstarget}-pct`).val(pct);
    if (pct == null) {
        $(`#${progresstarget}-pct`).hide();
    } else {
        $(`#${progresstarget}-pct`).show();

        if (pct < progresspct && pct < 10) {
            // reset start time if percentage goes back down to 0
            progressstarted = Date.now();
        }
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
            $(`#${progresstarget}-eta`).text(i18n.t("eta") + " " + timefmt(1000+remaining));
        } else {
            $(`#${progresstarget}-eta`).text(i18n.t("eta") + " ?");
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
        if (!inputs[i].id)
            continue;
        progressstate[inputs[i].id] = inputs[i].disabled;
        inputs[i].disabled = true;
    }

    progressstarted = Date.now();
    progressactive = true;
    progress(0);
    $(`#${progresstarget}-cancel`).show();
    $(`#${progresstarget}-cancel`).prop("disabled",false);
}

function progressEnd() {
    console.log("PROGRESS_END");
    // enable the inputs that were previously enabled
    for (const id in progressstate) {
        if (!id)
            continue;
        $('#' + id).prop('disabled', progressstate[id]);
    }

    progressstarted = null;
    progressactive = false;
    progress(null);
    $(`#${progresstarget}-cancel`).hide();
}

function progressReset() {
    progressstate = {};
    progressEnd();
}
