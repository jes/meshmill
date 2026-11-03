function ToolpathViewer(file, xoff, yoff, zoff, toolradius) {
    window.api.send('plot-toolpath', {
        file: file,
    }, function(path) {
        renderToolpath(path, xoff, yoff, zoff, toolradius);
    });
}

function renderToolpath(path, xoff, yoff, zoff, toolradius) {
    if (!path || path.length < 2 || !scene)
        return;

    simToolRadius = toolradius || 2;

    let points = path.map(function(p) {
        var xaxis = new THREE.Vector3(1,0,0);
        return new THREE.Vector3(p[0]-xoff,p[1]-yoff,p[2]-zoff).applyAxisAngle(xaxis, p[3]*Math.PI/180.0);
    });

    simPoints = points;
    simIndex = 0;

    let geometry = new THREE.BufferGeometry().setFromPoints(points);
    let material = new THREE.LineBasicMaterial({
        color: 0xb674c7,
        linewidth: 2,
    });
    simLine = new THREE.Line(geometry, material);
    scene.add(simLine);

    let progressGeometry = new THREE.BufferGeometry().setFromPoints(points);
    progressGeometry.setDrawRange(0, 0);
    simProgressLine = new THREE.Line(progressGeometry, new THREE.LineBasicMaterial({
        color: 0xffcc00,
        linewidth: 2,
    }));
    simProgressLine.visible = false;
    scene.add(simProgressLine);

    simTool = new THREE.Mesh(
        new THREE.SphereGeometry(simToolRadius, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff3333 })
    );
    simTool.visible = false;
    scene.add(simTool);

    updateSimButton();
}
