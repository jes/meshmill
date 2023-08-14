function ToolpathViewer(file, xoff, yoff, zoff) {
    window.api.send('plot-toolpath', {
        file: file,
    }, function(path) {
        renderToolpath(path, xoff, yoff, zoff);
    });
}

function renderToolpath(path, xoff, yoff, zoff) {
    let points = path.map(function(p) {
        var xaxis = new THREE.Vector3(1,0,0);
        return new THREE.Vector3(p[0]-xoff,p[1]-yoff,p[2]-zoff).applyAxisAngle(xaxis, p[3]*Math.PI/180.0);
    });
    let geometry = new THREE.BufferGeometry().setFromPoints(points);
    let material = new THREE.LineBasicMaterial({
        color: 0xb674c7,
        linewidth: 2,
    });
    let line = new THREE.Line(geometry, material);
    scene.add(line);
}
