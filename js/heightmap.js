/* based on https://stackoverflow.com/q/70609456 */

function HeightmapViewer(file) {
    var spacingX = 3;
    var spacingY = 3;
    var heightOffset = 2;

    var img = new Image();
    img.src = file;
    img.onload = function () {
        var w = img.width;
        var h = img.height;

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var pixel = ctx.getImageData(0, 0, w, h);

        var geom = new THREE.BufferGeometry();
        var vertices = new Float32Array(w*h*3*3);

        // add the coordinate for (x,y) to vertices[idx .. idx+2]
        var addVertex = function(x,y,idx) {
            var zValue = pixel.data[(y*w+x)*4] / heightOffset;

            vertices[idx] = x*spacingX;
            vertices[idx+1] = y*spacingY;
            vertices[idx+2] = zValue;
        };

        // add each square from the heightmap as 2 triangles
        var idx = 0;
        for (var y = 0; y < h-1; y++) {
            for (var x = 0; x < w-1; x++) {
                addVertex(x,y,idx);
                addVertex(x+1,y,idx+3);
                addVertex(x+1,y+1,idx+6);

                addVertex(x+1,y+1,idx+9);
                addVertex(x,y+1,idx+12);
                addVertex(x,y,idx+15);

                idx += 18;
            }
        }

        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geom.computeVertexNormals(true);
        
        showScene(geom);
    };
}
