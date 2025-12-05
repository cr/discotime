const pad2 = (n) => String(n).padStart(2,'0');
const sign = (n) => (n < 0 ? '-' : '+');
const fmtUtcIsoDate = (d) => d.toISOString().slice(0, 10);
const isDay = (sunrise, sunset, d) => (sunrise < d) && (d < sunset);

function fmtHHMMSS_UTC(d){
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function fmtHHMM_UTC(d){
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function fmtOffset(minutes){
    const m = Math.abs(minutes);
    const hh = Math.floor(m/60);
    const mm = m % 60;
    return `${sign(minutes)}${pad2(hh)}:${pad2(mm)}`;
}

function clampOffset(mins){
    const lim = 24*60; // ±24h
    return Math.max(-lim, Math.min(lim, mins));
}

// Degrees to degrees+decimal minutes string with padded degrees width
function toDegMinPad(v, posChar, negChar, width){
    const hemi = v >= 0 ? posChar : negChar;
    const av = Math.abs(v);
    const deg = Math.floor(av);
    const min = (av - deg) * 60;
    const degStr = String(deg).padStart(width,'0');
    const minStr = min.toFixed(2).padStart(5,'0'); // 00.00
    return `${degStr}°${minStr}'${hemi}`;
}

// Solar calculations (NOAA)
const ZENITH = 90.833; // degrees
const toRad = (deg) => deg * Math.PI / 180;
const toDeg = (rad) => rad * 180 / Math.PI;

function dayOfYearUTC(date){
    const start = Date.UTC(date.getUTCFullYear(),0,1);
    const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((now-start)/86400000)+1;
}

function gammaFracYear(date, minutes){
    return 2*Math.PI/365 * (dayOfYearUTC(date)-1 + minutes/1440);
}

function eqTimeDecl(g){
    const eqtime = 229.18*(0.000075 + 0.001868*Math.cos(g) - 0.032077*Math.sin(g) - 0.014615*Math.cos(2*g) - 0.040849*Math.sin(2*g));
    const decl = 0.006918 - 0.399912*Math.cos(g) + 0.070257*Math.sin(g) - 0.006758*Math.cos(2*g) + 0.000907*Math.sin(2*g) - 0.002697*Math.cos(3*g) + 0.00148*Math.sin(3*g);
    return { eqtime, decl };
}

function hourAngleSunrise(latRad, decl){
    const cosH = (Math.cos(toRad(ZENITH)) - Math.sin(latRad)*Math.sin(decl)) / (Math.cos(latRad)*Math.cos(decl));
    if (cosH < -1) return NaN; // polar day
    if (cosH >  1) return NaN; // polar night
    return Math.acos(cosH);
}

function minutesToUTCDate(baseUTC, minutes){
    const d = new Date(Date.UTC(baseUTC.getUTCFullYear(), baseUTC.getUTCMonth(), baseUTC.getUTCDate(), 0,0,0));
    d.setUTCMinutes(Math.round(minutes));
    return d;
}

function solarTimesUTC(baseUTC, latDeg, lonDeg){
    const latRad = toRad(latDeg);
    // estimate / refine solar noon
    let g = gammaFracYear(baseUTC, 0);
    let {eqtime, decl} = eqTimeDecl(g);
    let solNoonMin = 720 - 4*lonDeg - eqtime;
    g = gammaFracYear(baseUTC, solNoonMin);
    ({eqtime, decl} = eqTimeDecl(g));
    solNoonMin = 720 - 4*lonDeg - eqtime;
    const H = hourAngleSunrise(latRad, decl);
    if (!Number.isFinite(H)){
    return { sunrise:null, noon: minutesToUTCDate(baseUTC, solNoonMin), sunset:null, polar:true };
    }
    const delta = toDeg(H)*4;
    return {
    sunrise: minutesToUTCDate(baseUTC, solNoonMin - delta),
    noon:    minutesToUTCDate(baseUTC, solNoonMin),
    sunset:  minutesToUTCDate(baseUTC, solNoonMin + delta),
    polar:   false
    };
}