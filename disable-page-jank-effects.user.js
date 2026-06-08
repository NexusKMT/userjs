// ==UserScript==
// @name         Disable Page Jank Effects
// @namespace    local.universal.force-lite
// @version      3.0.0
// @description  Kill useless page effects (animations, blur/filter, Web Animations API loops, decorative canvas, decorative requestAnimationFrame loops). Toggle each feature from the Tampermonkey menu.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  "use strict";

  const PAGE = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
  const DOC = PAGE.document || document;
  const LOC = PAGE.location || location;
  const STORE = PAGE.localStorage || localStorage;

  const GLOBAL_KEY = "__universalForceLite";
  const ROOT_CLASS = "__ufl-root";
  const STYLE_ID = "__universalForceLiteStyle";
  const SHADOW_STYLE_ID = "__universalForceLiteShadowStyle";
  const BG_CANVAS_CLASS = "__ufl-bg-canvas";
  const STORAGE_PREFIX = "__ufl:";
  const LOG_PREFIX = "[Disable Page Jank]";
  const VERSION = "3.0.0";

  // Each feature is one Tampermonkey menu toggle. State is global (all sites).
  const FEATURES = {
    cssMotion: { label: "CSS 动画/过渡", default: true },
    visualEffects: { label: "模糊/滤镜", default: true },
    webAnimations: { label: "Web 动画", default: true },
    mediaPreferences: { label: "减少动效偏好", default: true },
    hideDecorativeCanvas: { label: "隐藏装饰 canvas", default: false },
    blockDecorativeRAF: { label: "屏蔽后台动画循环", default: false }
  };

  const FEATURE_ORDER = Object.keys(FEATURES);

  // ---------------------------------------------------------------------------
  // Settings storage (GM_* with localStorage fallback)
  // ---------------------------------------------------------------------------

  function readStoredValue(key, fallback) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallback);
      }
    } catch (error) {
      console.warn(LOG_PREFIX, "GM_getValue failed", error);
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
      console.warn(LOG_PREFIX, "localStorage read failed", error);
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
      console.warn(LOG_PREFIX, "GM_setValue failed", error);
    }

    try {
      STORE.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(LOG_PREFIX, "localStorage write failed", error);
    }
  }

  function featureStorageKey(name) {
    return `${STORAGE_PREFIX}${name}`;
  }

  function getFeature(name) {
    const meta = FEATURES[name];
    if (!meta) return false;
    return Boolean(readStoredValue(featureStorageKey(name), meta.default));
  }

  function setFeature(name, enabled) {
    if (!FEATURES[name]) throw new Error(`Unknown feature: ${name}`);
    writeStoredValue(featureStorageKey(name), Boolean(enabled));
  }

  function toggleFeature(name) {
    setFeature(name, !getFeature(name));
  }

  function getSettings() {
    const settings = {};
    for (const name of FEATURE_ORDER) settings[name] = getFeature(name);
    return settings;
  }

  // ---------------------------------------------------------------------------
  // CSS overrides (cssMotion / visualEffects / hideDecorativeCanvas)
  // ---------------------------------------------------------------------------

  function buildCssText(settings) {
    const parts = [];

    if (settings.cssMotion) {
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

    if (settings.visualEffects) {
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

    if (settings.hideDecorativeCanvas) {
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
    const parts = [];

    if (settings.cssMotion) {
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

    if (settings.visualEffects) {
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

  // ---------------------------------------------------------------------------
  // Canvas classification (used by hideDecorativeCanvas / blockDecorativeRAF)
  // ---------------------------------------------------------------------------

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

  function looksLikeDecorativeCanvas(canvas) {
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

  // ---------------------------------------------------------------------------
  // Forced matchMedia result (used by mediaPreferences)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Install: apply the enabled features (runs once at document-start)
  // ---------------------------------------------------------------------------

  function install() {
    const settings = getSettings();

    const native = {
      requestAnimationFrame: PAGE.requestAnimationFrame,
      matchMedia: PAGE.matchMedia,
      attachShadow: PAGE.Element && PAGE.Element.prototype.attachShadow,
      elementAnimate: PAGE.Element && PAGE.Element.prototype.animate,
      documentGetAnimations: DOC.getAnimations,
      startViewTransition: DOC.startViewTransition,
      startViewTransitionHadOwn: Object.prototype.hasOwnProperty.call(DOC, "startViewTransition"),
      setTimeout: PAGE.setTimeout
    };

    const state = {
      patchedShadowRoots: new WeakSet(),
      observer: null,
      hiddenCanvas: 0,
      webAnimationsFinished: 0,
      webAnimationsCanceled: 0,
      webAnimationsFailed: 0,
      blockedDecorativeRAF: 0,
      rafFakeId: 0
    };

    const wantsStyle = settings.cssMotion || settings.visualEffects || settings.hideDecorativeCanvas;
    const wantsShadow = settings.cssMotion || settings.visualEffects;
    const needsObserver =
      settings.cssMotion ||
      settings.visualEffects ||
      settings.hideDecorativeCanvas ||
      settings.webAnimations;

    function ensureStyle() {
      if (!wantsStyle || !DOC.documentElement) return;

      const css = buildCssText(settings);
      if (!css) return;

      let style = DOC.getElementById(STYLE_ID);
      if (!style) {
        style = DOC.createElement("style");
        style.id = STYLE_ID;
        DOC.documentElement.appendChild(style);
      }

      style.textContent = css;
      DOC.documentElement.classList.add(ROOT_CLASS);
    }

    function patchShadowRoot(root) {
      if (!wantsShadow || !root || state.patchedShadowRoots.has(root)) return;
      state.patchedShadowRoots.add(root);

      const css = buildShadowCssText(settings);
      if (!css) return;

      const style = DOC.createElement("style");
      style.id = SHADOW_STYLE_ID;
      style.textContent = css;
      root.appendChild(style);
    }

    function patchAttachShadow() {
      if (!wantsShadow || !native.attachShadow) return;

      PAGE.Element.prototype.attachShadow = function uflAttachShadow(init) {
        const root = native.attachShadow.call(this, init);
        patchShadowRoot(root);
        return root;
      };
    }

    function patchMediaPreferences() {
      if (!settings.mediaPreferences || !native.matchMedia) return;

      PAGE.matchMedia = function uflMatchMedia(query) {
        const normalized = String(query || "").toLowerCase().replace(/\s+/g, " ");

        if (
          normalized.includes("prefers-reduced-motion") ||
          normalized.includes("prefers-reduced-transparency") ||
          normalized.includes("prefers-reduced-data")
        ) {
          return makeForcedMediaQueryList(query, !normalized.includes("no-preference"));
        }

        return native.matchMedia.call(PAGE, query);
      };
    }

    // ---- Web Animations API ----

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
      if (!settings.webAnimations || !animation?.effect) return false;
      if (animation.playbackRate === 0) return false;

      const stateName = String(animation.playState || "");
      if (stateName === "idle" || stateName === "finished") return false;

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
      if (!settings.webAnimations || typeof native.documentGetAnimations !== "function") {
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

    function patchWebAnimations() {
      if (!settings.webAnimations) return;

      if (typeof native.elementAnimate === "function") {
        PAGE.Element.prototype.animate = function uflAnimate() {
          const animation = native.elementAnimate.apply(this, arguments);
          reduceWebAnimation(animation);
          return animation;
        };
      }

      if (typeof native.startViewTransition === "function") {
        DOC.startViewTransition = function uflViewTransition(callback) {
          const transition = native.startViewTransition.call(DOC, callback);
          native.requestAnimationFrame?.call(PAGE, reduceExistingWebAnimations);
          return transition;
        };
      }
    }

    // ---- decorative canvas ----

    function markDecorativeCanvases() {
      if (!settings.hideDecorativeCanvas || !DOC.querySelectorAll) return 0;

      let count = 0;
      for (const canvas of DOC.querySelectorAll("canvas")) {
        if (!looksLikeDecorativeCanvas(canvas)) continue;

        canvas.classList.add(BG_CANVAS_CLASS);
        canvas.style.display = "none";
        canvas.style.visibility = "hidden";
        canvas.style.pointerEvents = "none";
        count += 1;
      }

      state.hiddenCanvas = count;
      return count;
    }

    // ---- decorative requestAnimationFrame loops ----

    function patchRAF() {
      if (!settings.blockDecorativeRAF || !native.requestAnimationFrame) return;

      PAGE.requestAnimationFrame = function uflRAF(callback) {
        const callbackName = (callback && callback.name) || "";
        const stack = String(new Error().stack || "");
        const signal = `${callbackName}\n${stack}`;

        if (hasDecorativeSignal(signal) && !hasChartSignal(signal)) {
          state.blockedDecorativeRAF += 1;
          // Negative fake handle: never scheduled, and cancelAnimationFrame() ignores it.
          state.rafFakeId -= 1;
          return state.rafFakeId;
        }

        return native.requestAnimationFrame.call(PAGE, callback);
      };
    }

    // ---- re-apply on DOM growth ----

    const scheduleApply = (() => {
      let timer = 0;
      return () => {
        if (timer) return;
        timer = native.setTimeout.call(PAGE, () => {
          timer = 0;
          ensureStyle();
          if (settings.webAnimations) reduceExistingWebAnimations();
          if (settings.hideDecorativeCanvas) markDecorativeCanvases();
        }, 150);
      };
    })();

    function startObserver() {
      if (!needsObserver || state.observer || !DOC.documentElement || !PAGE.MutationObserver) return;

      state.observer = new PAGE.MutationObserver(scheduleApply);
      state.observer.observe(DOC.documentElement, { childList: true, subtree: true });
    }

    function stats() {
      return {
        version: VERSION,
        url: LOC.href,
        settings,
        hiddenCanvas: state.hiddenCanvas,
        webAnimationsFinished: state.webAnimationsFinished,
        webAnimationsCanceled: state.webAnimationsCanceled,
        webAnimationsFailed: state.webAnimationsFailed,
        remainingWebAnimations: getWebAnimations().filter(shouldReduceWebAnimation).length,
        blockedDecorativeRAF: state.blockedDecorativeRAF
      };
    }

    // Patch native APIs as early as possible (before page scripts run).
    patchMediaPreferences();
    patchWebAnimations();
    patchAttachShadow();
    patchRAF();
    ensureStyle();
    reduceExistingWebAnimations();

    // Minimal console-only handle for debugging (no on-page UI).
    PAGE[GLOBAL_KEY] = {
      version: VERSION,
      settings: getSettings,
      getFeature,
      setFeature(name, enabled) {
        setFeature(name, enabled);
        console.info(LOG_PREFIX, `${name} = ${getFeature(name)} (reload to apply)`);
      },
      toggleFeature(name) {
        toggleFeature(name);
        console.info(LOG_PREFIX, `${name} = ${getFeature(name)} (reload to apply)`);
      },
      stats
    };

    const finish = () => {
      ensureStyle();
      if (settings.webAnimations) reduceExistingWebAnimations();
      if (settings.hideDecorativeCanvas) markDecorativeCanvases();
      startObserver();
    };

    if (DOC.readyState === "loading") {
      DOC.addEventListener("DOMContentLoaded", finish, { once: true });
    } else {
      finish();
    }
  }

  // ---------------------------------------------------------------------------
  // Tampermonkey menu: one toggle per feature (top frame only)
  // ---------------------------------------------------------------------------

  function isTopFrame() {
    try {
      return PAGE.top === PAGE.self;
    } catch {
      return false;
    }
  }

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== "function" || !isTopFrame()) return;

    for (const name of FEATURE_ORDER) {
      const enabled = getFeature(name);
      const mark = enabled ? "✅" : "⬜";
      const action = enabled ? "点击关闭" : "点击开启";
      const label = `${mark} ${FEATURES[name].label} — ${action}`;

      GM_registerMenuCommand(label, () => {
        toggleFeature(name);
        // Reload so the new setting is applied cleanly from document-start,
        // and the menu rebuilds with the updated label.
        try {
          LOC.reload();
        } catch {
          location.reload();
        }
      });
    }
  }

  install();
  registerMenus();
})();
