/* Estimate machining time from G-code using job feed rates (mm/min). */

function estimateGcodeCycleTime(text, xyfeed, zfeed, rapidfeed) {
    if (!text) return 0;
    let xy = (xyfeed > 0) ? xyfeed : 1000;
    let zf = (zfeed > 0) ? zfeed : 100;
    let rapid = (rapidfeed > 0) ? rapidfeed : 4000;
    let X = 0, Y = 0, Z = 0;
    let lastF = rapid;
    let secs = 0;
    let lines = text.split(/\r?\n/);
    let moves = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let m = line.match(/^G0*([01])(?!\d)/i);
        if (!m) continue;
        let nx = X, ny = Y, nz = Z;
        let xm = line.match(/\bX([+\-0-9.]+)/i);
        let ym = line.match(/\bY([+\-0-9.]+)/i);
        let zm = line.match(/\bZ([+\-0-9.]+)/i);
        let fm = line.match(/\bF([+\-0-9.]+)/i);
        if (xm) nx = parseFloat(xm[1]);
        if (ym) ny = parseFloat(ym[1]);
        if (zm) nz = parseFloat(zm[1]);
        if (fm) lastF = parseFloat(fm[1]);
        // Prefer modal F from the file (pngcam puts F on every G1)
        let feed = (lastF > 0) ? lastF : ((m[1] === '0') ? rapid : xy);
        if (m[1] === '0') feed = rapid;
        let dx = nx - X, dy = ny - Y, dz = nz - Z;
        let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 1e-9) {
            secs += dist / (feed / 60);
            moves++;
        }
        X = nx; Y = ny; Z = nz;
    }
    return moves ? secs : 0;
}
