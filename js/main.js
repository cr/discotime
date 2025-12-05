// ===== App State =====
const els = {
    utcClock:     document.getElementById('utcClock'),
    utcDate:      document.getElementById('utcDate'),
    localTime:    document.getElementById('localTime'),
    localOffset:  document.getElementById('localOffset'),
    sunriseUTC:   document.getElementById('sunriseUTC'),
    noonUTC:      document.getElementById('noonUTC'),
    noonOffUTC:   document.getElementById('noonOffUTC'),
    sunsetUTC:    document.getElementById('sunsetUTC'),
    sunriseLocal: document.getElementById('sunriseLocal'),
    noonLocal:    document.getElementById('noonLocal'),
    sunsetLocal:  document.getElementById('sunsetLocal'),
    latVal:       document.getElementById('latVal'),
    lonVal:       document.getElementById('lonVal'),
    statusText:   document.getElementById('statusText'),
    btnPlus:      document.getElementById('btnPlus'),
    btnMinus:     document.getElementById('btnMinus'),
    fsToggleBtn:  document.getElementById('fsToggleBtn'),
    gpsRow:       document.getElementById('gpsRow'),
    sunUtcRow:    document.getElementById('sunUtcRow'),
    sunLocalRow:  document.getElementById('sunLocalRow'),
    utcSec:       document.getElementById('utcSec'),
    localRow:     document.getElementById('localRow')
};

let sunrise = null;
let noon = null;
let sunset = null;
let dayTheme = 'day';
let nightTheme = 'red';
let gpsMode = 'browser';
let signalKGeo = null;

// ===== LocalStorage =====
let offsetMinutes = parseInt(localStorage.getItem('localOffsetMinutes') || '0', 10);
offsetMinutes = clampOffset(isNaN(offsetMinutes) ? 0 : offsetMinutes);
let lastCoords = JSON.parse(localStorage.getItem('localLastCoords'));

// ===== Rendering =====
function renderUTC(){
    const now = new Date();
    els.utcDate.textContent = fmtUtcIsoDate(now);
    els.utcClock.textContent = fmtHHMMSS_UTC(now);
    if (sunrise) {
     document.documentElement.setAttribute('data-theme', isDay(sunrise, sunset, now) ? dayTheme : nightTheme);        
    }
}

function renderLocal(){
    const now = new Date();
    const ms = now.getTime() + offsetMinutes*60000; // apply manual offset vs UTC
    const d = new Date(ms);
    els.localTime.textContent = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; // display as if UTC shifted
    els.localOffset.textContent = fmtOffset(offsetMinutes);
}

function renderGPSAndSun(){
    const todayUTC = new Date();
    const baseUTC = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()));

    // GPS
    if (lastCoords){
        const { latitude, longitude } = lastCoords;
        els.latVal.textContent = toDegMinPad(latitude, 'N', 'S', 2);
        els.lonVal.textContent = toDegMinPad(longitude, 'E', 'W', 3);
    } else {
        els.latVal.textContent = "--°--.--'N";
        els.lonVal.textContent = "---°--.--'W";
    }

    // Sun (UTC)
    /* sunrise, noon, sunset are globals */
    if (lastCoords) {
        const sol = solarTimesUTC(baseUTC, lastCoords.latitude, lastCoords.longitude);
        sunrise = sol.sunrise; noon = sol.noon; sunset = sol.sunset;
    }
    els.sunriseUTC.textContent = sunrise ? fmtHHMM_UTC(sunrise) : '--:--';
    const noonOffsetMin = noon ? ((noon.getUTCHours()*60 + noon.getUTCMinutes()) - (12*60)) : 0;
    els.noonOffUTC.textContent = fmtOffset(noonOffsetMin);
    els.sunsetUTC.textContent  = sunset ? fmtHHMM_UTC(sunset) : '--:--';
    els.noonUTC.textContent = noon ? fmtHHMM_UTC(noon) : '--:--';

    // Sun (Local = UTC shifted by manual offset)
    const shift = (d) => d ? new Date(d.getTime() + offsetMinutes*60000) : null;
    const sRiseL = shift(sunrise), sNoonL = shift(noon), sSetL = shift(sunset);
    els.sunriseLocal.textContent = sRiseL ? fmtHHMM_UTC(sRiseL) : '--:--';
    els.noonLocal.firstChild.nodeValue = sNoonL ? fmtHHMM_UTC(sNoonL) : '--:--';
    els.sunsetLocal.textContent  = sSetL ? fmtHHMM_UTC(sSetL) : '--:--';
}

function setStatus(state){
    // state: 'request', 'locked', 'denied'
    if (state === 'request') {
        els.statusText.className = 'warn';
        els.statusText.textContent = 'Requesting location';
        els.statusText.onclick = null;
        } else if (state === 'locked') {
        els.statusText.className = 'ok';
        els.statusText.textContent = 'Locked';
        els.statusText.onclick = null;
    } else if (state === 'denied') {
        els.statusText.className = 'bad';
        els.statusText.textContent = 'No location (click retry)';
        els.statusText.onclick = () => requestLocation(true);
    }
}

// ===== Controls =====
function bumpOffset(delta){
    offsetMinutes = clampOffset(offsetMinutes + delta);
    localStorage.setItem('localOffsetMinutes', String(offsetMinutes));
    renderLocal();
    renderGPSAndSun();
}
document.getElementById('btnPlus').addEventListener('click', () => bumpOffset(+15));
document.getElementById('btnMinus').addEventListener('click', () => bumpOffset(-15));

// Keyboard: + / - adjust offset; f/Esc fullscreen
document.addEventListener('keydown', (e)=>{
    const key = e.key;
    if (key === 'f' || key === 'F') toggleFullscreen();
    if (key === 'Escape' && document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    if (key === '+' || key === '=' || e.code === 'NumpadAdd'){ e.preventDefault(); bumpOffset(+15); }
    if (key === '-' || e.code === 'NumpadSubtract'){ e.preventDefault(); bumpOffset(-15); }
});

// Fullscreen toggle via footer button
function toggleFullscreen(){
    if (!document.fullscreenElement){
        document.documentElement.requestFullscreen().catch(()=>{});
    } else {
        document.exitFullscreen().catch(()=>{});
    }
}
els.fsToggleBtn.addEventListener('click', toggleFullscreen);

// ===== Geolocation =====
const geolocationOptions = {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 60000
};
let clearWatchID = null;
function geolocationSuccess(pos) {
    // console.debug('Geolocation received:', pos)
    setStatus('locked');
    lastCoords = pos.coords;
    localStorage.setItem('localLastCoords', JSON.stringify(lastCoords));
    renderGPSAndSun();
}
function geolocationError(err) {
    console.error('Geolocation error:', err);
    if (clearWatchID) {
        setStatus('denied');
        clearWatchID();
        clearWatchID = null;
    }
}
function requestLocation() {
    if (gpsMode == 'browser') {
        if (!('geolocation' in navigator)){
            console.warn('Geolocation not supported');
            setStatus('denied');
            return;
        }
        setStatus('request');
        navigator.geolocation.getCurrentPosition(geolocationSuccess, geolocationError, geolocationOptions);
        if (!clearWatchID) {
            const id = navigator.geolocation.watchPosition(geolocationSuccess, geolocationError, geolocationOptions);
            clearWatchID = () => { navigator.geolocation.clearWatch(id) };
        }
    } else if (gpsMode == 'signalk') {
        setStatus('request');
        signalKGeo.getCurrentPosition(geolocationSuccess, geolocationError, geolocationOptions);
        if (!clearWatchID) {
            const id = signalKGeo.watchPosition(geolocationSuccess, geolocationError, geolocationOptions);
            clearWatchID = () => { signalKGeo.clearWatch(id) };
        }
    }
}

// Parse query parameters from the current URL
const p = new URLSearchParams(window.location.search);
if (p.has('day')) { dayTheme = p.get('day'); document.documentElement.setAttribute('data-theme', dayTheme); }
if (p.has('night')) { nightTheme = p.get('night'); }
if (p.has('signalk')) { gpsMode = 'signalk'; }

if (gpsMode == 'signalk') {
    signalKGeo = createSignalKGeolocation({
        host: p.get('signalk'),
        secure: false,
    });
}
console.debug("gpsMode:", gpsMode);

// Clocks update every second
setInterval(() => { renderUTC(); renderLocal(); }, 1000); // every second

// Initial paint
renderUTC();
renderLocal();
requestLocation();
renderGPSAndSun();