/* based on https://stackoverflow.com/q/70609456 */

function HeightmapViewer(file, x_mm, y_mm, z_mm) {
    var img = new Image();
    img.src = file + "?" + Math.random(); // XXX: avoid cache: but why are local files being cached?
    img.onload = function () {
        var w = img.width;
        var h = img.height;

        var x_mmperpx = x_mm / w;
        var y_mmperpx = y_mm / h;
        var z_mmperbrightness = z_mm / 255;

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var pixel = ctx.getImageData(0, 0, w, h);

        var geom = new THREE.BufferGeometry();
        var vertices = new Float32Array(w*h*36);

        // add the coordinate for (x,y) to vertices[idx .. idx+2]
        var addVertex = function(x,y,idx) {
            vertices[idx] = x*x_mmperpx;
            vertices[idx+1] = (h-y-1)*y_mmperpx;
            vertices[idx+2] = pixel.data[(y*w+x)*4] * z_mmperbrightness;
        };

        // add each square from the heightmap as 2 triangles
        var idx = 0;
        for (var y = 0; y < h-1; y++) {
            for (var x = 0; x < w-1; x++) {
                addVertex(x,y,idx);
                addVertex(x+1,y+1,idx+3);
                addVertex(x+1,y,idx+6);

                addVertex(x+1,y+1,idx+9);
                addVertex(x,y,idx+12);
                addVertex(x,y+1,idx+15);

                // and now the backfaces, just so that the mesh
                // doesn't look broken when viewed from below
                addVertex(x,y,idx+18);
                addVertex(x+1,y,idx+21);
                addVertex(x+1,y+1,idx+24);

                addVertex(x+1,y+1,idx+27);
                addVertex(x,y+1,idx+30);
                addVertex(x,y,idx+33);

                idx += 36;
            }
        }

        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geom.computeVertexNormals(true);
        
        showScene(geom);
    };
}
