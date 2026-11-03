/* G-code path plotting + data for material-removal simulation */

var simPathPoints = []; // [x,y,z,A,isCut] in scene coordinates

function disposeSceneObject(obj) {
    if (!obj || !scene) return;
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
        if (Array.isArray(obj.material))
            obj.material.forEach(function(m) { m.dispose(); });
        else
            obj.material.dispose();
    }
}

function clearToolpathLines() {
    disposeSceneObject(simLine);
    disposeSceneObject(simProgressLine);
    disposeSceneObject(simTool);
    simLine = null;
    simProgressLine = null;
    simTool = null;
}

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

    // Drop previous path lines so they cannot linger on top of a stock preview
    clearToolpathLines();

    simToolRadius = toolradius || 2;

    let xaxis = new THREE.Vector3(1, 0, 0);
    simPathPoints = [];
    let points = [];

    for (let i = 0; i < path.length; i++) {
        let p = path[i];
        let v = new THREE.Vector3(p[0] - xoff, p[1] - yoff, p[2] - zoff);
        if (p[3])
            v.applyAxisAngle(xaxis, p[3] * Math.PI / 180.0);
        points.push(v);
        simPathPoints.push([v.x, v.y, v.z, p[3] || 0, p[4] ? 1 : 0]);
    }

    simPoints = points;
    simIndex = 0;

    let geometry = new THREE.BufferGeometry().setFromPoints(points);
    let material = new THREE.LineBasicMaterial({
        color: 0xb674c7,
        linewidth: 2,
        depthTest: true,
        depthWrite: false,
    });
    simLine = new THREE.Line(geometry, material);
    scene.add(simLine);

    let progressGeometry = new THREE.BufferGeometry().setFromPoints(points);
    progressGeometry.setDrawRange(0, 0);
    simProgressLine = new THREE.Line(progressGeometry, new THREE.LineBasicMaterial({
        color: 0xffcc00,
        linewidth: 2,
        depthTest: true,
        depthWrite: false,
    }));
    simProgressLine.visible = false;
    scene.add(simProgressLine);

    simTool = new THREE.Mesh(
        new THREE.SphereGeometry(simToolRadius, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false })
    );
    simTool.visible = false;
    scene.add(simTool);
    needsRender = true;

    updateSimButton();
}
