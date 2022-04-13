function ToolpathViewer(file) {
    window.api.receive('toolpath-points', function(path) {
        renderToolpath(path);
    });
    window.api.send('plot-toolpath', {
        file: file,
    });
}

function renderToolpath(path) {
    let points = path.map(function(p) {
        return new THREE.Vector3(p[0]-scenemiddle.x,p[1]-scenemiddle.y,p[2]-scenemiddle.z);
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
