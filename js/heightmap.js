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

        // add each square from the heightmap as 2 triangles.
        // Sample the image so that the preview mesh stays reasonably small
        // even for high-resolution heightmaps.
        var step = Math.max(1, Math.ceil(Math.max(w, h) / 80));
        var cells = Math.ceil((w-1)/step) * Math.ceil((h-1)/step);
        vertices = new Float32Array(cells*36);
        var idx = 0;
        for (var y = 0; y < h-1; y += step) {
            var y2 = Math.min(y+step, h-1);
            for (var x = 0; x < w-1; x += step) {
                var x2 = Math.min(x+step, w-1);
                addVertex(x,y,idx);
                addVertex(x2,y2,idx+3);
                addVertex(x2,y,idx+6);

                addVertex(x2,y2,idx+9);
                addVertex(x,y,idx+12);
                addVertex(x,y2,idx+15);

                // backfaces, so that the mesh doesn't look broken from below
                addVertex(x,y,idx+18);
                addVertex(x2,y,idx+21);
                addVertex(x2,y2,idx+24);

                addVertex(x2,y2,idx+27);
                addVertex(x,y2,idx+30);
                addVertex(x,y,idx+33);

                idx += 36;
            }
        }

        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

        // Cheap height shading without lighting/normals (important for
        // software rendering): colour vertices by height.
        let minz = Infinity, maxz = -Infinity;
        for (let i = 2; i < vertices.length; i += 3) {
            let z = vertices[i];
            if (z < minz) minz = z;
            if (z > maxz) maxz = z;
        }
        let span = Math.max(1e-6, maxz - minz);
        let colors = new Float32Array(vertices.length);
        for (let i = 0; i < vertices.length; i += 3) {
            let t = (vertices[i+2] - minz) / span;
            // dark teal -> bright teal
            colors[i] = 0.05 + 0.05*t;
            colors[i+1] = 0.35 + 0.55*t;
            colors[i+2] = 0.32 + 0.37*t;
        }
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        showScene(geom, {
            origin: origin,
            vertexColors: true,
        });

        if (cb) cb();
    };
}
