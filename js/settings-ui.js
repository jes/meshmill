let Settings = {};

$('#save').click(function() {
    Settings.imperial = $('#imperial').prop('checked');
    Settings.workflow_hints = $('#workflowhints').prop('checked');
    Settings.show_heightmap_2d = $('#showheightmap2d').prop('checked');
    Settings.maxvel = $('#maxvel').val();
    Settings.maxaccel = $('#maxaccel').val();
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
    $('#maxvel').val(Settings.maxvel);
    $('#maxaccel').val(Settings.maxaccel);
});
