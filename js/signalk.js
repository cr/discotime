// Factory that creates a SignalK-backed geolocation object
function createSignalKGeolocation({
  wsUrl = null,
  host = "localhost:3000",
  secure = false,
} = {}) {

  // Build URL if not explicitly provided
  if (!wsUrl) {
    const proto = secure ? "wss://" : "ws://";
    // host may already include a port
    wsUrl = `${proto}${host}/signalk/v1/stream?subscribe=delta`;
  }

  console.log("[SignalK] using WS URL:", wsUrl);

  const GEO_ERROR = {
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };

  let ws = null;
  let nextWatchId = 1;
  const watchers = new Map(); // id -> { success, error, options }

  // latest known navigation state
  const state = {
    latitude: null,
    longitude: null,
    altitude: null,
    speed: null,   // m/s
    heading: null, // deg
  };

  let lastPosition = null;

  function makeGeoError(code, message) {
    const err = { code, message };
    err.PERMISSION_DENIED = GEO_ERROR.PERMISSION_DENIED;
    err.POSITION_UNAVAILABLE = GEO_ERROR.POSITION_UNAVAILABLE;
    err.TIMEOUT = GEO_ERROR.TIMEOUT;
    return err;
  }

  function radToDeg(rad) {
    if (rad == null) return null;
    const deg = (rad * 180) / Math.PI;
    return (deg % 360 + 360) % 360;
  }

  function buildPosition(ts) {
    if (state.latitude == null || state.longitude == null) return null;
    return {
      coords: {
        latitude: state.latitude,
        longitude: state.longitude,
        altitude: state.altitude,
        accuracy: 0,
        altitudeAccuracy: null,
        heading: state.heading,
        speed: state.speed,
      },
      timestamp: ts,
    };
  }

  function notifyWatchers(pos) {
    if (!pos) return;
    lastPosition = pos;
    for (const { success } of watchers.values()) {
      try {
        success(pos);
      } catch (e) {
        console.error("[SignalK] watcher callback failed:", e);
      }
    }
  }

  function connect() {
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    console.debug("[SignalK] connecting:", wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.debug("[SignalK] WS open");
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.error("[SignalK] bad JSON:", e);
        return;
      }
      if (!msg.updates) return;

      for (const u of msg.updates) {
        const ts = u.timestamp ? new Date(u.timestamp).getTime() : Date.now();

        for (const v of u.values || []) {
          const path = v.path;
          const val = v.value;

          // Debug: see what we actually get
          // console.debug("[SignalK] path:", path, "value:", val);

          if (path === "navigation.position" && val && typeof val === "object") {
            state.latitude = val.latitude ?? state.latitude;
            state.longitude = val.longitude ?? state.longitude;
            state.altitude = val.altitude ?? state.altitude;
          } else if (path === "navigation.speedOverGround") {
            if (typeof val === "number") state.speed = val;
          } else if (path === "navigation.courseOverGroundTrue") {
            const deg = radToDeg(val);
            if (deg != null) state.heading = deg;
          }

          const pos = buildPosition(ts);
          if (pos) notifyWatchers(pos);
        }
      }
    };

    ws.onerror = (event) => {
      console.error("[SignalK] WS error", event);
      for (const { error } of watchers.values()) {
        if (!error) continue;
        try {
          error(
            makeGeoError(
              GEO_ERROR.POSITION_UNAVAILABLE,
              "SignalK WebSocket error"
            )
          );
        } catch (e) {
          console.error("[SignalK] error callback failed:", e);
        }
      }
    };

    ws.onclose = (event) => {
      console.debug("[SignalK] WS closed", event.code, event.reason);
      ws = null;
      if (watchers.size > 0) {
        setTimeout(connect, 2000);
      }
    };
  }

  function watchPosition(success, error, options = {}) {
    if (typeof success !== "function") {
      throw new TypeError("watchPosition requires a success callback");
    }

    const id = nextWatchId++;
    watchers.set(id, { success, error, options });

    connect();

    // Immediately give the latest position, if we have one
    if (lastPosition) {
      const maxAge = options.maximumAge;
      if (maxAge == null) {
        try {
          success(lastPosition);
        } catch (e) {
          console.error("[SignalK] watcher immediate callback failed:", e);
        }
      } else {
        const age = Date.now() - lastPosition.timestamp;
        if (age <= maxAge) {
          try {
            success(lastPosition);
          } catch (e) {
            console.error("[SignalK] watcher immediate callback failed:", e);
          }
        }
      }
    }

    return id;
  }

  function clearWatch(id) {
    watchers.delete(id);
    if (watchers.size === 0 && ws) {
      console.debug("[SignalK] no watchers left, closing WS");
      ws.close();
      ws = null;
    }
  }

  function getCurrentPosition(success, error, options = {}) {
    if (typeof success !== "function") {
      throw new TypeError("getCurrentPosition requires a success callback");
    }

    // If we already have something, return it right away
    if (lastPosition) {
      const maxAge = options.maximumAge;
      if (maxAge == null) {
        success(lastPosition);
        return;
      }
      const age = Date.now() - lastPosition.timestamp;
      if (age <= maxAge) {
        success(lastPosition);
        return;
      }
    }

    // Otherwise, do a one-shot watch
    let done = false;
    const watchId = watchPosition(
      (pos) => {
        if (done) return;
        done = true;
        clearWatch(watchId);
        success(pos);
      },
      (err) => {
        if (done) return;
        done = true;
        clearWatch(watchId);
        if (error) error(err);
      },
      options
    );

    // NOTE: we *ignore* options.timeout here for now.
    // If you really want a timeout, you can add a fixed one:
    /*
    const SIGNALK_TIMEOUT_MS = 20000;
    setTimeout(() => {
      if (done) return;
      done = true;
      clearWatch(watchId);
      if (error) {
        error(makeGeoError(GEO_ERROR.TIMEOUT, "SignalK getCurrentPosition timeout"));
      }
    }, SIGNALK_TIMEOUT_MS);
    */
  }

  return {
    getCurrentPosition,
    watchPosition,
    clearWatch,
    GEO_ERROR,
  };
}
