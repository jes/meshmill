let Settings = {};

function applyLang(lang) {
    i18n.setLang(lang || 'ru');
    i18n.apply(document);
}

$('#language').change(function() {
    applyLang($('#language').val());
});

$('#save').click(function() {
    Settings.imperial = $('#imperial').prop('checked');
    Settings.workflow_hints = $('#workflowhints').prop('checked');
    Settings.show_heightmap_2d = $('#showheightmap2d').prop('checked');
    Settings.cam_backend = $('#cambackend').val() || 'gpu';
    Settings.maxvel = $('#maxvel').val();
    Settings.maxaccel = $('#maxaccel').val();
    Settings.lang = $('#language').val() || 'ru';
    window.api.send('set-settings', Settings);
    window.close();
});

$('#cancel').click(function() {
    window.close();
});

window.api.send('settings-get-settings', function(s) {
    Settings = s;
    $('#imperial').prop('checked', Settings.imperial);
    $('#workflowhints').prop('checked', Settings.workflow_hints);
    $('#showheightmap2d').prop('checked', Settings.show_heightmap_2d);
    $('#cambackend').val(Settings.cam_backend || 'gpu');
    $('#maxvel').val(Settings.maxvel);
    $('#maxaccel').val(Settings.maxaccel);
    $('#language').val(Settings.lang || 'ru');
    applyLang(Settings.lang || 'ru');
});
