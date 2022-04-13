function ToolpathViewer(file, xoff, yoff, zoff) {
    window.api.send('plot-toolpath', {
        file: file,
    }, function(path) {
        renderToolpath(path, xoff, yoff, zoff);
    });
}

function renderToolpath(path, xoff, yoff, zoff) {
    let points = path.map(function(p) {
        return new THREE.Vector3(p[0]-xoff,p[1]-yoff,p[2]-zoff);
    });
    let geometry = new THREE.BufferGeometry().setFromPoints(points);
    let material = new THREE.LineBasicMaterial({
        color: 0xb674c7,
        linewidth: 2,
    });
    let line = new THREE.Line(geometry, material);
    // TODO: re-initialise the scene from scratch, with the relevant heightmap
    scene.add(line);
}
