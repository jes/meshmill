function timefmt(millis) {
    let hours = Math.floor(millis/3600000);
    millis -= hours*3600000;
    let mins = Math.floor(millis/60000);
    millis -= mins*60000;
    let secs = Math.floor(millis/1000);
    millis -= secs*1000;

    if (hours) return hours + "h" + mins + "m";
    if (mins) return mins + "m" + secs + "s";
    return secs + "s";
}

function formatFloat(f) {
    let dp = 2;
    let n = 0.1;

    if (f < 0) return "-" + formatFloat(-f);
    if (f < 0.0000001) return "0.00";

    while (f < n) {
        n /= 10;
        dp++;
    }

    return f.toFixed(dp);
}
