// ==UserScript==
// @name         Disable Page Jank Effects
// @namespace    local.universal.force-lite
// @version      2.1.0
// @description  Opt-in userscript that disables costly page animations, Web Animations API effects, blur effects, decorative canvas, and RAF loops on allowlisted sites.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  "use strict";

  const PAGE = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
  const DOC = PAGE.document || document;
  const LOC = PAGE.location || location;
  const STORE = PAGE.localStorage || localStorage;
  const PERF = PAGE.performance || performance;

  const GLOBAL_KEY = "__universalForceLite";
  const ROOT_CLASS = "__ufl-root";
  const STYLE_ID = "__universalForceLiteStyle";
  const SHADOW_STYLE_ID = "__universalForceLiteShadowStyle";
  const BG_CANVAS_CLASS = "__ufl-bg-canvas";
  const STORAGE_PREFIX = "__ufl:";
  const MODE_KEY = `${STORAGE_PREFIX}mode`;
  const ALLOWLIST_KEY = `${STORAGE_PREFIX}allowlist`;
  const HOST_SETTINGS_PREFIX = `${STORAGE_PREFIX}host:`;

  const DEFAULT_MODE = "conservative";
  const DEFAULT_VALUES = {
    chartFrameMs: 80,
    genericFrameMs: 66
  };

  const FEATURES = {
    cssMotion: {
      label: "CSS motion",
      description: "Disable CSS animations, transitions, and smooth scrolling."
    },
    visualEffects: {
      label: "Blur/filter effects",
      description: "Disable blur, backdrop-filter, and CSS filter effects."
    },
    contentVisibility: {
      label: "Content visibility",
      description: "Use content-visibility on repeated panels, lists, tables, and dashboard regions."
    },
    shadowDomStyles: {
      label: "Shadow DOM styles",
      description: "Inject the CSS motion/effect overrides into new shadow roots."
    },
    mediaPreferences: {
      label: "Reduced media prefs",
      description: "Make JS matchMedia report reduced motion, transparency, and data preferences."
    },
    webAnimations: {
      label: "Web Animations API",
      description: "Finish finite Element.animate animations and cancel infinite Web Animations API loops."
    },
    hideDecorativeCanvas: {
      label: "Hide decorative canvas",
      description: "Hide likely background, particle, or full-bleed decorative canvases while preserving chart-like canvases."
    },
    blockDecorativeRAF: {
      label: "Block decorative RAF",
      description: "Block requestAnimationFrame loops whose call stack looks like decorative background animation."
    },
    throttleChartRAF: {
      label: "Throttle chart RAF",
      description: "Throttle requestAnimationFrame loops from chart/rendering libraries."
    },
    throttleGenericRAF: {
      label: "Throttle generic RAF",
      description: "Throttle other requestAnimationFrame loops."
    }
  };

  const FEATURE_ORDER = Object.keys(FEATURES);

  const MODES = {
    off: {
      label: "Off",
      features: Object.fromEntries(FEATURE_ORDER.map((name) => [name, false]))
    },
    conservative: {
      label: "Conservative",
      features: {
        cssMotion: true,
        visualEffects: true,
        contentVisibility: false,
        shadowDomStyles: true,
        mediaPreferences: true,
        webAnimations: true,
        hideDecorativeCanvas: false,
        blockDecorativeRAF: false,
        throttleChartRAF: false,
        throttleGenericRAF: false
      }
    },
    balanced: {
      label: "Balanced",
      features: {
        cssMotion: true,
        visualEffects: true,
        contentVisibility: true,
        shadowDomStyles: true,
        mediaPreferences: true,
        webAnimations: true,
        hideDecorativeCanvas: false,
        blockDecorativeRAF: false,
        throttleChartRAF: true,
        throttleGenericRAF: true
      },
      values: {
        chartFrameMs: 80,
        genericFrameMs: 50
      }
    },
    aggressive: {
      label: "Aggressive",
      features: {
        cssMotion: true,
        visualEffects: true,
        contentVisibility: true,
        shadowDomStyles: true,
        mediaPreferences: true,
        webAnimations: true,
        hideDecorativeCanvas: true,
        blockDecorativeRAF: true,
        throttleChartRAF: true,
        throttleGenericRAF: true
      },
      values: {
        chartFrameMs: 100,
        genericFrameMs: 66
      }
    }
  };

  function readStoredValue(key, fallback) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallback);
      }
    } catch (error) {
      console.warn("[Universal Force Lite] GM_getValue failed", error);
    }

    try {
      const raw = STORE.getItem(key);
      if (raw === null) return fallback;

      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch (error) {
      console.warn("[Universal Force Lite] localStorage read failed", error);
      return fallback;
    }
  }

  function writeStoredValue(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }
    } catch (error) {
      console.warn("[Universal Force Lite] GM_setValue failed", error);
    }

    try {
      STORE.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("[Universal Force Lite] localStorage write failed", error);
    }
  }

  function deleteStoredValue(key) {
    try {
      if (typeof GM_deleteValue === "function") {
        GM_deleteValue(key);
        return;
      }
    } catch (error) {
      console.warn("[Universal Force Lite] GM_deleteValue failed", error);
    }

    try {
      STORE.removeItem(key);
    } catch (error) {
      console.warn("[Universal Force Lite] localStorage delete failed", error);
    }
  }

  function normalizeHostPattern(value) {
    const host = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^\.+|\.+$/g, "");

    if (!host || host === "*") return "";
    if (host.startsWith("*.")) return `*.${host.slice(2).replace(/^\.+|\.+$/g, "")}`;
    return host;
  }

  function currentHost() {
    return normalizeHostPattern(LOC.hostname);
  }

  function hostSettingsKey(host = currentHost()) {
    const normalized = normalizeHostPattern(host);
    return normalized ? `${HOST_SETTINGS_PREFIX}${normalized}` : "";
  }

  function getAllowlist() {
    const stored = readStoredValue(ALLOWLIST_KEY, []);
    const list = Array.isArray(stored) ? stored : [];
    return Array.from(new Set(list.map(normalizeHostPattern).filter(Boolean))).sort();
  }

  function setAllowlist(list) {
    const normalized = Array.from(new Set(list.map(normalizeHostPattern).filter(Boolean))).sort();
    if (normalized.length) writeStoredValue(ALLOWLIST_KEY, normalized);
    else deleteStoredValue(ALLOWLIST_KEY);
    return normalized;
  }

  function addAllowedHost(host = currentHost()) {
    const normalized = normalizeHostPattern(host);
    if (!normalized) return getAllowlist();
    return setAllowlist([...getAllowlist(), normalized]);
  }

  function removeAllowedHost(host = currentHost()) {
    const normalized = normalizeHostPattern(host);
    if (!normalized) return getAllowlist();
    return setAllowlist(getAllowlist().filter((entry) => entry !== normalized));
  }

  function hostMatchesPattern(host, pattern) {
    if (host === pattern) return true;
    if (!pattern.startsWith("*.")) return false;

    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  function hostAllowed(host = currentHost()) {
    const normalized = normalizeHostPattern(host);
    if (!normalized) return false;
    return getAllowlist().some((pattern) => hostMatchesPattern(normalized, pattern));
  }

  function getModeName() {
    const stored = readStoredValue(MODE_KEY, DEFAULT_MODE);
    return MODES[stored] ? stored : DEFAULT_MODE;
  }

  function setModeName(modeName) {
    if (!MODES[modeName]) throw new Error(`Unknown mode: ${modeName}`);
    writeStoredValue(MODE_KEY, modeName);
  }

  function sanitizeHostSettings(raw) {
    const settings = raw && typeof raw === "object" ? raw : {};
    const features = {};
    const values = {};

    if (settings.features && typeof settings.features === "object") {
      for (const name of FEATURE_ORDER) {
        if (typeof settings.features[name] === "boolean") {
          features[name] = settings.features[name];
        }
      }
    }

    if (settings.values && typeof settings.values === "object") {
      for (const key of Object.keys(DEFAULT_VALUES)) {
        const value = Number(settings.values[key]);
        if (Number.isFinite(value) && value >= 16 && value <= 1000) {
          values[key] = Math.round(value);
        }
      }
    }

    return { features, values };
  }

  function getHostSettings(host = currentHost()) {
    const key = hostSettingsKey(host);
    if (!key) return { features: {}, values: {} };
    return sanitizeHostSettings(readStoredValue(key, { features: {}, values: {} }));
  }

  function writeHostSettings(settings, host = currentHost()) {
    const key = hostSettingsKey(host);
    if (!key) return getHostSettings(host);

    const sanitized = sanitizeHostSettings(settings);
    const hasFeatures = Object.keys(sanitized.features).length > 0;
    const hasValues = Object.keys(sanitized.values).length > 0;

    if (hasFeatures || hasValues) writeStoredValue(key, sanitized);
    else deleteStoredValue(key);

    return sanitized;
  }

  function getEffectiveSettings(modeName = getModeName(), host = currentHost()) {
    const mode = MODES[modeName] || MODES[DEFAULT_MODE];
    const hostSettings = getHostSettings(host);
    const features = {};

    for (const name of FEATURE_ORDER) {
      const presetValue = Boolean(mode.features[name]);
      features[name] =
        typeof hostSettings.features[name] === "boolean"
          ? hostSettings.features[name]
          : presetValue;
    }

    return {
      modeName,
      modeLabel: mode.label,
      host,
      features,
      values: Object.assign({}, DEFAULT_VALUES, mode.values || {}, hostSettings.values),
      overrides: hostSettings
    };
  }

  function anyFeatureEnabled(features) {
    return FEATURE_ORDER.some((name) => Boolean(features[name]));
  }

  function disabledReason(modeName, settings) {
    if (modeName === "off") return "mode=off";
    if (!hostAllowed()) return "host not in allowlist";
    if (!anyFeatureEnabled(settings.features)) return "all features disabled";
    return "not enabled";
  }

  function applyFeatureOverride(name, enabled, host = currentHost()) {
    if (!FEATURES[name]) throw new Error(`Unknown feature: ${name}`);
    const settings = getHostSettings(host);
    settings.features[name] = Boolean(enabled);
    writeHostSettings(settings, host);
    return getEffectiveSettings(getModeName(), host);
  }

  function clearFeatureOverride(name, host = currentHost()) {
    if (!FEATURES[name]) throw new Error(`Unknown feature: ${name}`);
    const settings = getHostSettings(host);
    delete settings.features[name];
    writeHostSettings(settings, host);
    return getEffectiveSettings(getModeName(), host);
  }

  function clearAllFeatureOverrides(host = currentHost()) {
    writeHostSettings({ features: {}, values: {} }, host);
    return getEffectiveSettings(getModeName(), host);
  }

  function toggleFeatureOverride(name, host = currentHost()) {
    const effective = getEffectiveSettings(getModeName(), host);
    return applyFeatureOverride(name, !effective.features[name], host);
  }

  function applyFrameMsOverride(name, value, host = currentHost()) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_VALUES, name)) {
      throw new Error(`Unknown frame setting: ${name}`);
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 16 || numeric > 1000) {
      throw new Error(`${name} must be between 16 and 1000ms`);
    }

    const settings = getHostSettings(host);
    settings.values[name] = Math.round(numeric);
    writeHostSettings(settings, host);
    return getEffectiveSettings(getModeName(), host);
  }

  function getFeatureList(modeName = getModeName(), host = currentHost()) {
    const effective = getEffectiveSettings(modeName, host);
    return FEATURE_ORDER.map((name) => ({
      name,
      label: FEATURES[name].label,
      enabled: effective.features[name],
      override:
        typeof effective.overrides.features[name] === "boolean"
          ? effective.overrides.features[name]
          : null,
      description: FEATURES[name].description
    }));
  }

  function buildCssText(settings) {
    const { features } = settings;
    const parts = [];

    if (features.cssMotion) {
      parts.push(`
        html.${ROOT_CLASS} *,
        html.${ROOT_CLASS} *::before,
        html.${ROOT_CLASS} *::after {
          animation-name: none !important;
          animation-duration: 0.001ms !important;
          animation-delay: 0s !important;
          animation-iteration-count: 1 !important;
          transition-property: none !important;
          transition-duration: 0s !important;
          scroll-behavior: auto !important;
        }
      `);
    }

    if (features.visualEffects) {
      parts.push(`
        html.${ROOT_CLASS} *,
        html.${ROOT_CLASS} *::before,
        html.${ROOT_CLASS} *::after {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          filter: none !important;
        }

        html.${ROOT_CLASS} [class*="blur"],
        html.${ROOT_CLASS} [class*="glass"],
        html.${ROOT_CLASS} [class*="backdrop"],
        html.${ROOT_CLASS} [style*="backdrop-filter"],
        html.${ROOT_CLASS} [style*="-webkit-backdrop-filter"],
        html.${ROOT_CLASS} [style*="filter: blur"] {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          filter: none !important;
        }
      `);
    }

    if (features.contentVisibility) {
      parts.push(`
        html.${ROOT_CLASS} main > section,
        html.${ROOT_CLASS} main > article,
        html.${ROOT_CLASS} main > div,
        html.${ROOT_CLASS} [role="main"] > section,
        html.${ROOT_CLASS} [role="main"] > article,
        html.${ROOT_CLASS} [class*="dashboard"] > *,
        html.${ROOT_CLASS} [class*="card"],
        html.${ROOT_CLASS} [class*="panel"],
        html.${ROOT_CLASS} [class*="table"],
        html.${ROOT_CLASS} [class*="list"],
        html.${ROOT_CLASS} [class*="grid"],
        html.${ROOT_CLASS} .semi-card,
        html.${ROOT_CLASS} .semi-table,
        html.${ROOT_CLASS} .semi-tabs-content,
        html.${ROOT_CLASS} .semi-collapse,
        html.${ROOT_CLASS} .ant-card,
        html.${ROOT_CLASS} .ant-table,
        html.${ROOT_CLASS} .MuiCard-root,
        html.${ROOT_CLASS} .MuiTable-root {
          content-visibility: auto !important;
          contain-intrinsic-size: 1px 360px !important;
        }
      `);
    }

    if (features.hideDecorativeCanvas) {
      parts.push(`
        html.${ROOT_CLASS} canvas.${BG_CANVAS_CLASS} {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `);
    }

    return parts.join("\n");
  }

  function buildShadowCssText(settings) {
    const { features } = settings;
    const parts = [];

    if (features.cssMotion) {
      parts.push(`
        *, *::before, *::after {
          animation-name: none !important;
          animation-duration: 0.001ms !important;
          animation-delay: 0s !important;
          animation-iteration-count: 1 !important;
          transition-property: none !important;
          transition-duration: 0s !important;
          scroll-behavior: auto !important;
        }
      `);
    }

    if (features.visualEffects) {
      parts.push(`
        *, *::before, *::after {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          filter: none !important;
        }
      `);
    }

    return parts.join("\n");
  }

  function hasChartSignal(text) {
    const value = String(text || "").toLowerCase();
    return (
      value.includes("chart") ||
      value.includes("vchart") ||
      value.includes("visactor") ||
      value.includes("echarts") ||
      value.includes("highcharts") ||
      value.includes("apexcharts") ||
      value.includes("chart.js") ||
      value.includes("plotly") ||
      value.includes("uplot")
    );
  }

  function hasDecorativeSignal(text) {
    const value = String(text || "").toLowerCase();
    return (
      value.includes("background") ||
      value.includes("canvas-bg") ||
      value.includes("particle") ||
      value.includes("starfield") ||
      value.includes("aurora") ||
      value.includes("gradient") ||
      value.includes("decorative") ||
      value.includes("confetti") ||
      value.includes("sparkle") ||
      value.includes("snow") ||
      value.includes("firework") ||
      value.includes("bokeh") ||
      value.includes("blob") ||
      value.includes("wave") ||
      value.includes("noise")
    );
  }

  function canvasTextSignals(canvas) {
    const values = [];
    let node = canvas;

    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      values.push(node.id || "");
      values.push(String(node.className || ""));
      values.push(node.getAttribute?.("aria-label") || "");
      values.push(node.getAttribute?.("role") || "");
    }

    return values.join(" ");
  }

  function looksLikeChartCanvas(canvas) {
    const text = canvasTextSignals(canvas);
    if (hasChartSignal(text)) return true;
    if (String(canvas.id || "").startsWith("visactor_window_")) return true;

    const role = String(canvas.getAttribute?.("role") || "").toLowerCase();
    const aria = String(canvas.getAttribute?.("aria-label") || "").toLowerCase();
    return role.includes("img") && hasChartSignal(aria);
  }

  function looksLikeDecorativeCanvas(canvas, settings) {
    if (!settings.features.hideDecorativeCanvas) return false;
    if (!canvas || looksLikeChartCanvas(canvas)) return false;

    const rect = canvas.getBoundingClientRect();
    const text = canvasTextSignals(canvas);
    const style = PAGE.getComputedStyle(canvas);
    const fullBleed =
      rect.width >= PAGE.innerWidth * 0.7 &&
      rect.height >= PAGE.innerHeight * 0.45;
    const backgroundLayout =
      style.position === "fixed" ||
      style.position === "absolute" ||
      style.pointerEvents === "none" ||
      Number(style.zIndex || 0) < 1;

    return hasDecorativeSignal(text) || (fullBleed && backgroundLayout);
  }

  function makeForcedMediaQueryList(query, matches) {
    const listeners = new Set();
    const mediaQueryList = {
      matches,
      media: query,
      onchange: null,
      addListener(listener) {
        if (typeof listener === "function") listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
      addEventListener(type, listener) {
        if (type === "change" && typeof listener === "function") listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "change") listeners.delete(listener);
      },
      dispatchEvent(event) {
        for (const listener of listeners) {
          listener.call(mediaQueryList, event);
        }

        if (typeof mediaQueryList.onchange === "function") {
          mediaQueryList.onchange.call(mediaQueryList, event);
        }

        return true;
      }
    };

    return mediaQueryList;
  }

  function install(modeName = getModeName()) {
    PAGE[GLOBAL_KEY]?.restore?.();

    const settings = getEffectiveSettings(modeName);
    const isAllowed = hostAllowed();
    const shouldRun =
      modeName !== "off" &&
      isAllowed &&
      anyFeatureEnabled(settings.features);

    if (!shouldRun) {
      const disabledController = createController({
        disabled: true,
        reason: disabledReason(modeName, settings),
        settings,
        stats: () => ({
          url: LOC.href,
          hostname: currentHost(),
          modeName,
          disabled: true,
          reason: disabledReason(modeName, settings),
          allowed: isAllowed,
          allowlist: getAllowlist(),
          features: settings.features,
          values: settings.values,
          overrides: settings.overrides
        }),
        restore: () => {
          delete PAGE[GLOBAL_KEY];
        }
      });

      PAGE[GLOBAL_KEY] = disabledController;
      return disabledController;
    }

    const native = {
      requestAnimationFrame: PAGE.requestAnimationFrame,
      cancelAnimationFrame: PAGE.cancelAnimationFrame,
      matchMedia: PAGE.matchMedia,
      attachShadow: PAGE.Element.prototype.attachShadow,
      elementAnimate: PAGE.Element.prototype.animate,
      elementAnimateHadOwn: Object.prototype.hasOwnProperty.call(PAGE.Element.prototype, "animate"),
      documentGetAnimations: DOC.getAnimations,
      startViewTransition: DOC.startViewTransition,
      startViewTransitionHadOwn: Object.prototype.hasOwnProperty.call(DOC, "startViewTransition"),
      setTimeout: PAGE.setTimeout,
      clearTimeout: PAGE.clearTimeout
    };

    const state = {
      settings,
      appliedAt: new Date().toISOString(),
      hiddenCanvas: 0,
      webAnimationsFinished: 0,
      webAnimationsCanceled: 0,
      webAnimationsFailed: 0,
      blockedDecorativeRAF: 0,
      throttledChartRAF: 0,
      throttledGenericRAF: 0,
      observer: null,
      rafHandles: new Map(),
      patchedShadowRoots: new WeakSet(),
      shadowStyles: new Set(),
      seq: 1,
      lastChartFrame: 0,
      lastGenericFrame: 0
    };

    function ensureStyle() {
      if (!DOC.documentElement) return;

      let style = DOC.getElementById(STYLE_ID);
      if (!style) {
        style = DOC.createElement("style");
        style.id = STYLE_ID;
        DOC.documentElement.appendChild(style);
      }

      style.textContent = buildCssText(settings);
      DOC.documentElement.classList.add(ROOT_CLASS);
    }

    function patchShadowRoot(root) {
      if (!settings.features.shadowDomStyles || !root || state.patchedShadowRoots.has(root)) return;
      state.patchedShadowRoots.add(root);

      const style = DOC.createElement("style");
      style.id = SHADOW_STYLE_ID;
      style.textContent = buildShadowCssText(settings);
      root.appendChild(style);
      state.shadowStyles.add(style);
    }

    function patchAttachShadow() {
      if (!settings.features.shadowDomStyles || !native.attachShadow) return;

      PAGE.Element.prototype.attachShadow = function universalForceLiteAttachShadow(init) {
        const root = native.attachShadow.call(this, init);
        patchShadowRoot(root);
        return root;
      };
    }

    function patchMediaPreferences() {
      if (!settings.features.mediaPreferences || !native.matchMedia) return;

      PAGE.matchMedia = function universalForceLiteMatchMedia(query) {
        const normalized = String(query || "").toLowerCase().replace(/\s+/g, " ");

        if (normalized.includes("prefers-reduced-motion")) {
          return makeForcedMediaQueryList(query, !normalized.includes("no-preference"));
        }

        if (normalized.includes("prefers-reduced-transparency")) {
          return makeForcedMediaQueryList(query, !normalized.includes("no-preference"));
        }

        if (normalized.includes("prefers-reduced-data")) {
          return makeForcedMediaQueryList(query, !normalized.includes("no-preference"));
        }

        return native.matchMedia.call(PAGE, query);
      };
    }

    function webAnimationTarget(animation) {
      try {
        return animation?.effect?.target || null;
      } catch {
        return null;
      }
    }

    function webAnimationEndTime(animation) {
      try {
        const timing = animation?.effect?.getComputedTiming?.();
        if (timing && Number.isFinite(Number(timing.endTime))) {
          return Number(timing.endTime);
        }

        if (timing && timing.endTime === Infinity) {
          return Infinity;
        }
      } catch {
        // Some browser/polyfill AnimationEffect objects throw while detached.
      }

      try {
        const timing = animation?.effect?.getTiming?.();
        const duration = Number(timing?.duration) || 0;
        const iterations = timing?.iterations;
        if (iterations === Infinity) return Infinity;
        return duration * (Number(iterations) || 1);
      } catch {
        return Infinity;
      }
    }

    function shouldReduceWebAnimation(animation) {
      if (!settings.features.webAnimations || !animation?.effect) return false;
      if (animation.playbackRate === 0) return false;

      const stateName = String(animation.playState || "");
      if (stateName === "idle" || stateName === "finished") return false;

      const target = webAnimationTarget(animation);
      if (target?.closest?.("[data-ufl-keep-animation]")) return false;

      return true;
    }

    function reduceWebAnimation(animation) {
      if (!shouldReduceWebAnimation(animation)) return false;

      try {
        if (Number.isFinite(webAnimationEndTime(animation))) {
          animation.finish();
          state.webAnimationsFinished += 1;
          return true;
        }

        animation.cancel();
        state.webAnimationsCanceled += 1;
        return true;
      } catch {
        try {
          animation.cancel();
          state.webAnimationsCanceled += 1;
          return true;
        } catch {
          state.webAnimationsFailed += 1;
          return false;
        }
      }
    }

    function getWebAnimations() {
      if (!settings.features.webAnimations || typeof native.documentGetAnimations !== "function") {
        return [];
      }

      try {
        return Array.from(native.documentGetAnimations.call(DOC, { subtree: true }) || []);
      } catch {
        try {
          return Array.from(native.documentGetAnimations.call(DOC) || []);
        } catch {
          return [];
        }
      }
    }

    function reduceExistingWebAnimations() {
      let count = 0;
      for (const animation of getWebAnimations()) {
        if (reduceWebAnimation(animation)) count += 1;
      }
      return count;
    }

    function remainingReducibleWebAnimationCount() {
      let count = 0;
      for (const animation of getWebAnimations()) {
        if (shouldReduceWebAnimation(animation)) count += 1;
      }
      return count;
    }

    function patchWebAnimations() {
      if (!settings.features.webAnimations) return;

      if (typeof native.elementAnimate === "function") {
        PAGE.Element.prototype.animate = function universalForceLiteAnimate() {
          const animation = native.elementAnimate.apply(this, arguments);
          reduceWebAnimation(animation);
          return animation;
        };
      }

      if (typeof native.startViewTransition === "function") {
        DOC.startViewTransition = function universalForceLiteViewTransition(callback) {
          const transition = native.startViewTransition.call(DOC, callback);
          native.requestAnimationFrame?.call(PAGE, reduceExistingWebAnimations);
          return transition;
        };
      }
    }

    function restoreProperty(target, name, value, hadOwn) {
      if (!target) return;

      if (hadOwn) {
        target[name] = value;
        return;
      }

      try {
        delete target[name];
      } catch {
        target[name] = value;
      }
    }

    function markDecorativeCanvases() {
      if (!settings.features.hideDecorativeCanvas || !DOC.querySelectorAll) return 0;

      let count = 0;
      for (const canvas of DOC.querySelectorAll("canvas")) {
        if (!looksLikeDecorativeCanvas(canvas, settings)) continue;

        canvas.classList.add(BG_CANVAS_CLASS);
        canvas.style.display = "none";
        canvas.style.visibility = "hidden";
        canvas.style.pointerEvents = "none";
        count += 1;
      }

      state.hiddenCanvas = count;
      return count;
    }

    function makeHandle(cancel) {
      const id = state.seq++;
      state.rafHandles.set(id, cancel);
      return id;
    }

    function patchRAF() {
      const shouldPatch =
        settings.features.blockDecorativeRAF ||
        settings.features.throttleChartRAF ||
        settings.features.throttleGenericRAF;

      if (!shouldPatch || !native.requestAnimationFrame || !native.cancelAnimationFrame) return;

      PAGE.requestAnimationFrame = function universalForceLiteRAF(callback) {
        const callbackName = callback?.name || "";
        const stack = String(new Error().stack || "");
        const signal = `${callbackName}\n${stack}`;
        const isDecorative = hasDecorativeSignal(signal);
        const isChart = hasChartSignal(signal);

        if (settings.features.blockDecorativeRAF && isDecorative && !isChart) {
          state.blockedDecorativeRAF += 1;
          return makeHandle(() => {});
        }

        const shouldThrottle =
          (isChart && settings.features.throttleChartRAF) ||
          (!isChart && settings.features.throttleGenericRAF);

        if (!shouldThrottle) {
          return native.requestAnimationFrame.call(PAGE, callback);
        }

        const minGap = isChart ? settings.values.chartFrameMs : settings.values.genericFrameMs;
        const id = makeHandle(() => {});

        const rafId = native.requestAnimationFrame.call(PAGE, (timestamp) => {
          if (!state.rafHandles.has(id)) return;

          const last = isChart ? state.lastChartFrame : state.lastGenericFrame;
          const elapsed = timestamp - last;

          if (elapsed < minGap) {
            const timeoutId = native.setTimeout.call(PAGE, () => {
              if (!state.rafHandles.has(id)) return;

              state.rafHandles.delete(id);
              const now = PERF.now();
              if (isChart) {
                state.lastChartFrame = now;
                state.throttledChartRAF += 1;
              } else {
                state.lastGenericFrame = now;
                state.throttledGenericRAF += 1;
              }
              callback(now);
            }, Math.max(0, minGap - elapsed));

            state.rafHandles.set(id, () => native.clearTimeout.call(PAGE, timeoutId));
            return;
          }

          state.rafHandles.delete(id);
          if (isChart) state.lastChartFrame = timestamp;
          else state.lastGenericFrame = timestamp;
          callback(timestamp);
        });

        state.rafHandles.set(id, () => native.cancelAnimationFrame.call(PAGE, rafId));
        return id;
      };

      PAGE.cancelAnimationFrame = function universalForceLiteCancelRAF(id) {
        const cancel = state.rafHandles.get(id);
        if (cancel) {
          cancel();
          state.rafHandles.delete(id);
          return;
        }

        native.cancelAnimationFrame.call(PAGE, id);
      };
    }

    const scheduleApply = (() => {
      let timer = 0;
      return () => {
        if (timer) return;

        timer = native.setTimeout.call(PAGE, () => {
          timer = 0;
          ensureStyle();
          reduceExistingWebAnimations();
          markDecorativeCanvases();
        }, 150);
      };
    })();

    function startObserver() {
      if (!DOC.documentElement || !PAGE.MutationObserver) return;

      state.observer = new PAGE.MutationObserver(scheduleApply);
      state.observer.observe(DOC.documentElement, {
        childList: true,
        subtree: true
      });
    }

    function stats() {
      const canvases = DOC.querySelectorAll
        ? Array.from(DOC.querySelectorAll("canvas")).map((canvas, index) => ({
            index,
            id: canvas.id || "",
            className: String(canvas.className || ""),
            display: PAGE.getComputedStyle(canvas).display,
            visibility: PAGE.getComputedStyle(canvas).visibility,
            width: canvas.width,
            height: canvas.height,
            chartLike: looksLikeChartCanvas(canvas),
            decorativeLike: looksLikeDecorativeCanvas(canvas, settings)
          }))
        : [];

      return {
        url: LOC.href,
        hostname: currentHost(),
        modeName,
        disabled: false,
        reason: "enabled",
        allowed: isAllowed,
        allowlist: getAllowlist(),
        appliedAt: state.appliedAt,
        hiddenCanvas: state.hiddenCanvas,
        webAnimationsFinished: state.webAnimationsFinished,
        webAnimationsCanceled: state.webAnimationsCanceled,
        webAnimationsFailed: state.webAnimationsFailed,
        documentWebAnimations: getWebAnimations().length,
        remainingWebAnimations: remainingReducibleWebAnimationCount(),
        blockedDecorativeRAF: state.blockedDecorativeRAF,
        throttledChartRAF: state.throttledChartRAF,
        throttledGenericRAF: state.throttledGenericRAF,
        pendingRAFHandles: state.rafHandles.size,
        nodes: DOC.getElementsByTagName ? DOC.getElementsByTagName("*").length : null,
        canvases,
        usedJSHeapSize: PERF.memory?.usedJSHeapSize || null,
        features: settings.features,
        values: settings.values,
        overrides: settings.overrides
      };
    }

    function restore() {
      state.observer?.disconnect();

      for (const cancel of state.rafHandles.values()) cancel();
      state.rafHandles.clear();

      PAGE.requestAnimationFrame = native.requestAnimationFrame;
      PAGE.cancelAnimationFrame = native.cancelAnimationFrame;
      PAGE.matchMedia = native.matchMedia;
      PAGE.Element.prototype.attachShadow = native.attachShadow;
      restoreProperty(
        PAGE.Element.prototype,
        "animate",
        native.elementAnimate,
        native.elementAnimateHadOwn
      );
      restoreProperty(
        DOC,
        "startViewTransition",
        native.startViewTransition,
        native.startViewTransitionHadOwn
      );

      DOC.documentElement?.classList.remove(ROOT_CLASS);
      DOC.getElementById(STYLE_ID)?.remove();

      for (const style of state.shadowStyles) {
        style.remove();
      }
      state.shadowStyles.clear();

      if (DOC.querySelectorAll) {
        for (const canvas of DOC.querySelectorAll(`canvas.${BG_CANVAS_CLASS}`)) {
          canvas.classList.remove(BG_CANVAS_CLASS);
          canvas.style.display = "";
          canvas.style.visibility = "";
          canvas.style.pointerEvents = "";
        }
      }

      delete PAGE[GLOBAL_KEY];
      console.info("[Universal Force Lite] restored");
    }

    const controller = createController({
      disabled: false,
      reason: "enabled",
      settings,
      state,
      stats,
      restore,
      reapply() {
        ensureStyle();
        reduceExistingWebAnimations();
        markDecorativeCanvases();
        return stats();
      }
    });

    PAGE[GLOBAL_KEY] = controller;
    patchWebAnimations();
    ensureStyle();
    patchAttachShadow();
    patchMediaPreferences();
    patchRAF();
    reduceExistingWebAnimations();

    if (DOC.readyState === "loading") {
      DOC.addEventListener(
        "DOMContentLoaded",
        () => {
          ensureStyle();
          reduceExistingWebAnimations();
          markDecorativeCanvases();
          startObserver();
          console.info("[Universal Force Lite] enabled", stats());
        },
        { once: true }
      );
    } else {
      reduceExistingWebAnimations();
      markDecorativeCanvases();
      startObserver();
      console.info("[Universal Force Lite] enabled", stats());
    }

    return controller;
  }

  function createController(base) {
    return {
      state: base.state || null,
      settings: base.settings,
      disabled: base.disabled,
      reason: base.reason,
      stats: base.stats,
      restore: base.restore,
      reapply() {
        if (typeof base.reapply === "function") return base.reapply();
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.();
      },
      setMode(mode) {
        setModeName(mode);
        install(mode);
        return PAGE[GLOBAL_KEY]?.stats?.();
      },
      addHost(host = currentHost()) {
        const allowlist = addAllowedHost(host);
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.() || { allowlist };
      },
      removeHost(host = currentHost()) {
        const allowlist = removeAllowedHost(host);
        base.restore?.();
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.() || { allowlist };
      },
      setAllowlist(list) {
        setAllowlist(Array.isArray(list) ? list : []);
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.();
      },
      listHosts() {
        return getAllowlist();
      },
      listFeatures() {
        return getFeatureList();
      },
      setFeature(name, enabled) {
        applyFeatureOverride(name, enabled);
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.();
      },
      toggleFeature(name) {
        toggleFeatureOverride(name);
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.();
      },
      resetFeature(name) {
        clearFeatureOverride(name);
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.();
      },
      resetFeatures() {
        clearAllFeatureOverrides();
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.();
      },
      setFrameMs(name, value) {
        applyFrameMsOverride(name, value);
        install(getModeName());
        return PAGE[GLOBAL_KEY]?.stats?.();
      }
    };
  }

  function registerMenu(label, action) {
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand(label, action);
    }
  }

  function reinstallCurrentMode() {
    install(getModeName());
  }

  install();

  registerMenu("Universal Force Lite: stats", () => {
    console.table(PAGE[GLOBAL_KEY]?.stats?.() || {});
  });
  registerMenu("Universal Force Lite: list features", () => {
    console.table(getFeatureList());
  });
  registerMenu("Universal Force Lite: allow this host", () => {
    addAllowedHost(currentHost());
    reinstallCurrentMode();
  });
  registerMenu("Universal Force Lite: remove this host", () => {
    removeAllowedHost(currentHost());
    PAGE[GLOBAL_KEY]?.restore?.();
    reinstallCurrentMode();
  });
  registerMenu("Universal Force Lite: list allowlist", () => {
    console.table(getAllowlist().map((host) => ({ host })));
  });

  for (const modeName of Object.keys(MODES)) {
    registerMenu(`Universal Force Lite: mode ${modeName}`, () => {
      setModeName(modeName);
      install(modeName);
    });
  }

  for (const featureName of FEATURE_ORDER) {
    registerMenu(`Universal Force Lite: toggle ${featureName}`, () => {
      toggleFeatureOverride(featureName);
      reinstallCurrentMode();
      console.table(getFeatureList());
    });
  }

  registerMenu("Universal Force Lite: reset feature overrides", () => {
    clearAllFeatureOverrides();
    reinstallCurrentMode();
    console.table(getFeatureList());
  });
})();
