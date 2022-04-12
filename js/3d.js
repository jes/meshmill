STLViewer("/home/jes/cad/sake-set/insert.stl");

var container;
var camera;
var renderer;

function STLViewer(model) {
    container = document.getElementById('scene');
    while(container.firstChild) container.removeChild(container.firstChild);

    camera = new THREE.PerspectiveCamera(70, container.clientWidth/container.clientHeight, 1, 1000);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
    });
    renderer.setClearColor(0x888888, 1);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize, false);
    onWindowResize();

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.rotateSpeed = 0.25;
    controls.dampingFactor = 0.99;
    controls.enableZoom = true;
    controls.autoRotate = false;

    var scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    camera.add(new THREE.DirectionalLight(0xffffff, 0.75));
    scene.add(camera);

    (new THREE.STLLoader()).load(model, function (geometry) {
        var material = new THREE.MeshPhongMaterial({ 
            color: 0x0cf4c7,
            shininess: 1,
            specular: 1,
        });
        var mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        var middle = new THREE.Vector3();
        geometry.computeBoundingBox();
        geometry.boundingBox.getCenter(middle);
        mesh.geometry.applyMatrix(new THREE.Matrix4().makeTranslation(-middle.x, -middle.y, -middle.z));

        var largestDimension = Math.max(geometry.boundingBox.max.x, geometry.boundingBox.max.y, geometry.boundingBox.max.z);
        camera.position.z = largestDimension * 1.5;

        var animate = function () {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }; 

        animate();
    });
}

function onWindowResize() {
    renderer.setSize(0,0);
    let rect = container.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
}
