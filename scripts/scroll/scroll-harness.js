/* Injected into the generated overlay page for the Electron/CDP scenario suite.
   Drives the REAL page DOM + real auto-scroll controller (no mocks). */
(function () {
  "use strict";
  var demo = window.__overlayDemo;
  if (!demo || !demo.autoScroll) {
    window.__scrollHarness = { error: "auto-scroll controller missing" };
    return;
  }
  var controller = demo.autoScroll;
  var elements = demo.elements;
  var answerEl = elements.answerEl;
  var questionEl = elements.questionEl;
  var scrollViewport = elements.scrollViewport;
  var jumpPill = elements.jumpPill;
  var STORAGE_KEY = "hireshade.overlay.scroll.v1:" + demo.sessionId;
  var WORDS = [
    "rate", "limiter", "Redis", "token", "bucket", "fixed", "window", "sliding",
    "counter", "fallback", "latency", "metric", "observability", "queue", "retry",
    "idempotent", "shard", "partition", "replica", "consensus", "throughput",
    "tail", "p99", "alert", "dashboard", "incident", "runbook", "rollback",
  ];

  function nextFrame() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        resolve();
      });
    });
  }

  function snapshot() {
    var state = controller.getSnapshot();
    return {
      pinned: state.pinned,
      pillVisible: state.pillVisible,
      offset: state.offset,
      maxOffset: state.maxOffset,
      distanceFromBottom: state.distanceFromBottom,
      hasOverflow: state.hasOverflow,
      questionVersion: state.questionVersion,
      reducedMotion: state.reducedMotion,
      frameStats: controller.getFrameStats(),
      saveCount: controller.getSaveCount(),
      pillHidden: jumpPill.hidden,
      pillAriaHidden: jumpPill.getAttribute("aria-hidden"),
    };
  }

  function growAnswer(word) {
    answerEl.textContent += word + " ";
    demo.syncScrollViewportHeight();
    controller.notifyContentChanged();
  }

  function resetQuestion(text) {
    answerEl.textContent = "";
    questionEl.textContent = text;
    demo.syncScrollViewportHeight();
    controller.notifyQuestionChanged();
    controller.notifyContentChanged();
  }

  window.__scrollHarness = {
    snapshot: snapshot,

    async reset(options) {
      var clearStorage = !options || options.clearStorage !== false;
      if (clearStorage) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
          /* ignore */
        }
      }
      resetQuestion("Can you explain how you would design a rate limiter using Redis?");
      await nextFrame();
      await nextFrame();
      return snapshot();
    },

    /** Streams N content-growth frames and records distance-from-bottom each frame. */
    async streamAndSample(tokenCount) {
      var samples = [];
      for (var i = 0; i < tokenCount; i++) {
        growAnswer(WORDS[i % WORDS.length] + i);
        await nextFrame();
        samples.push(controller.getSnapshot().distanceFromBottom);
      }
      var maxDistance = samples.reduce(function (max, value) {
        return Math.max(max, value);
      }, 0);
      return { samples: samples, maxDistance: maxDistance, snapshot: snapshot() };
    },

    /** Streams tokens without sampling (used between scenarios). */
    async appendTokens(tokenCount) {
      for (var i = 0; i < tokenCount; i++) {
        growAnswer(WORDS[i % WORDS.length] + i);
        await nextFrame();
      }
      return snapshot();
    },

    /** Synthetic user scroll-up (wheel event, as a trackpad/mouse would send). */
    async scrollUp(pixels) {
      scrollViewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -(pixels || 40),
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
      await nextFrame();
      return snapshot();
    },

    /** Click the jump-to-latest pill and wait for the animation to settle. */
    async clickPill() {
      jumpPill.click();
      await new Promise(function (resolve) {
        setTimeout(resolve, 320);
      });
      await nextFrame();
      return snapshot();
    },

    /** Click the pill and snapshot in the same task (reduced-motion proof). */
    clickPillImmediate() {
      jumpPill.click();
      return snapshot();
    },

    /** New question: reset answer pane, scroll question into view, report rects. */
    async newQuestion(text) {
      resetQuestion(text);
      await new Promise(function (resolve) {
        setTimeout(resolve, 260);
      });
      await nextFrame();
      var viewportRect = scrollViewport.getBoundingClientRect();
      var questionRect = questionEl.getBoundingClientRect();
      var answerRect = answerEl.getBoundingClientRect();
      return {
        snapshot: snapshot(),
        questionTopInViewport: questionRect.top - viewportRect.top,
        answerTopInViewport: answerRect.top - viewportRect.top,
        viewportHeight: viewportRect.height,
      };
    },

    /** Short answer: no overflow, no pill, no jump. */
    async shortAnswer(text) {
      questionEl.textContent = "Quick question about your last project?";
      answerEl.textContent = text || "Short answer.";
      demo.syncScrollViewportHeight();
      controller.notifyQuestionChanged();
      controller.notifyContentChanged();
      await nextFrame();
      await nextFrame();
      return snapshot();
    },

    /** Persist the current position (the controller throttles writes). */
    async persistState() {
      await new Promise(function (resolve) {
        setTimeout(resolve, 320);
      });
      var raw = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (error) {
        raw = null;
      }
      return { raw: raw, parsed: raw ? JSON.parse(raw) : null, snapshot: snapshot() };
    },

    storageRaw() {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch (error) {
        return null;
      }
    },

    /** Dispatch a document keydown (real event path used by the adapter). */
    dispatchKey(key) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true }),
      );
      return snapshot();
    },

    async wait(ms) {
      await new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
      await nextFrame();
      return snapshot();
    },

    activeElement() {
      var active = document.activeElement;
      return {
        tag: active ? active.tagName : null,
        text: active && active.textContent ? active.textContent.slice(0, 80) : null,
        isBody: active === document.body,
      };
    },

    rects() {
      return {
        viewport: scrollViewport.getBoundingClientRect().toJSON(),
        question: questionEl.getBoundingClientRect().toJSON(),
        answer: answerEl.getBoundingClientRect().toJSON(),
        contentHeight: elements.scrollContent.scrollHeight,
        answerText: answerEl.textContent,
      };
    },
  };
})();
