/* based on https://stackoverflow.com/q/70609456 */

function HeightmapViewer(file, size, offset, origin, rotary, cb) {
    var img = new Image();
    img.src = file + "?" + Math.random(); // XXX: avoid cache: but why are local files being cached?
    img.onload = function () {
        var w = img.width;
        var h = img.height;

        var x_mmperpx = size.x / w;
        var y_mmperpx = size.y / h;
        var z_mmperbrightness = size.z / 16777215;
        if (rotary) {
            y_mmperpx = 360.0 / (h-1);
        }

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
            var r = pixel.data[(y*w+x)*4];
            var g = pixel.data[(y*w+x)*4+1];
            var b = pixel.data[(y*w+x)*4+2];
            var height = r*65536 + g*256 + b;

            if (rotary) {
                var angle = y*y_mmperpx * Math.PI / 180.0;
                vertices[idx] = x*x_mmperpx + offset.x;
                vertices[idx+1] = height * z_mmperbrightness * Math.sin(angle);
                vertices[idx+2] = height * z_mmperbrightness * Math.cos(angle);
            } else {
                vertices[idx] = x*x_mmperpx + offset.x;
                vertices[idx+1] = (h-y-1)*y_mmperpx + offset.y;
                vertices[idx+2] = height * z_mmperbrightness + offset.z;
            }
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
        
        showScene(geom, {
            origin: origin,
        });

        if (cb) cb();
    };
}
