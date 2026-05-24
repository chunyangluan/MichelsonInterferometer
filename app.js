(function () {
  "use strict";

  const DEFAULT_CONFIG = {
    rootId: "michelsonExperiment",
    canvasId: "interferogram",
    wavelengthSliderId: "wavelength",
    filmThicknessSliderId: "filmThickness",
    wavelengthValueId: "wavelengthValue",
    filmThicknessValueId: "filmThicknessValue",
    focalLengthMm: 200
  };

  class MichelsonInterferometer {
    constructor(config = {}) {
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.root = document.getElementById(this.config.rootId);
      this.canvas = document.getElementById(this.config.canvasId);
      this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
      this.wavelengthSlider = document.getElementById(this.config.wavelengthSliderId);
      this.filmThicknessSlider = document.getElementById(this.config.filmThicknessSliderId);
      this.wavelengthValue = document.getElementById(this.config.wavelengthValueId);
      this.filmThicknessValue = document.getElementById(this.config.filmThicknessValueId);
      this.readouts = {
        lambdaMm: document.getElementById("lambdaMmValue"),
        focalLength: document.getElementById("focalLengthValue"),
        opdCenter: document.getElementById("opdCenterValue"),
        formulaOpdCenter: document.getElementById("formulaOpdCenterValue"),
        centerIntensity: document.getElementById("centerIntensityValue"),
        thetaEdge: document.getElementById("thetaEdgeValue"),
        opdEdge: document.getElementById("opdEdgeValue"),
        fringeOrderCenter: document.getElementById("fringeOrderCenterValue"),
        edgeIntensity: document.getElementById("edgeIntensityValue")
      };
      this.pendingFrame = null;

      this.handleControlInput = this.handleControlInput.bind(this);
    }

    init() {
      this.validateElements();
      this.bindEvents();
      this.draw();
      this.setReadyState(true);
      this.dispatchLifecycleEvent("ready");
      return this;
    }

    destroy() {
      this.unbindEvents();

      if (this.pendingFrame !== null) {
        cancelAnimationFrame(this.pendingFrame);
        this.pendingFrame = null;
      }

      this.setReadyState(false);
      this.dispatchLifecycleEvent("destroy");
    }

    validateElements() {
      const requiredElements = [
        ["experiment root", this.root],
        ["canvas", this.canvas],
        ["canvas context", this.ctx],
        ["wavelength slider", this.wavelengthSlider],
        ["film thickness slider", this.filmThicknessSlider],
        ["wavelength value", this.wavelengthValue],
        ["film thickness value", this.filmThicknessValue]
      ];

      const missing = requiredElements
        .filter(([, element]) => !element)
        .map(([name]) => name);

      if (missing.length > 0) {
        throw new Error(`MichelsonInterferometer missing required elements: ${missing.join(", ")}`);
      }
    }

    bindEvents() {
      this.bindSlider(this.wavelengthSlider);
      this.bindSlider(this.filmThicknessSlider);
    }

    unbindEvents() {
      this.unbindSlider(this.wavelengthSlider);
      this.unbindSlider(this.filmThicknessSlider);
    }

    bindSlider(slider) {
      slider.addEventListener("input", this.handleControlInput);
      slider.addEventListener("change", this.handleControlInput);
    }

    unbindSlider(slider) {
      slider.removeEventListener("input", this.handleControlInput);
      slider.removeEventListener("change", this.handleControlInput);
    }

    handleControlInput() {
      this.requestDraw();
    }

    requestDraw() {
      if (this.pendingFrame !== null) {
        cancelAnimationFrame(this.pendingFrame);
      }

      this.pendingFrame = requestAnimationFrame(() => {
        this.pendingFrame = null;
        this.draw();
      });
    }

    getParameters() {
      return {
        wavelengthNm: Number(this.wavelengthSlider.value),
        filmThicknessMm: Number(this.filmThicknessSlider.value),
        focalLengthMm: this.config.focalLengthMm
      };
    }

    setParameters(parameters = {}) {
      if (Number.isFinite(parameters.wavelengthNm)) {
        this.wavelengthSlider.value = String(parameters.wavelengthNm);
      }

      if (Number.isFinite(parameters.filmThicknessMm)) {
        this.filmThicknessSlider.value = String(parameters.filmThicknessMm);
      }

      this.draw();
    }

    calculateIntensity(radiusMm, wavelengthNm, filmThicknessMm) {
      const opticalPathDifference = this.calculateOpticalPathDifference(radiusMm, filmThicknessMm);
      const wavelengthMm = wavelengthNm * 1e-6;
      const phase = (2 * Math.PI * opticalPathDifference) / wavelengthMm;
      const normalizedIntensity = (1 + Math.cos(phase)) / 2;

      return Math.max(0, Math.min(1, normalizedIntensity));
    }

    calculateTheta(radiusMm) {
      return Math.atan(radiusMm / this.config.focalLengthMm);
    }

    calculateOpticalPathDifference(radiusMm, filmThicknessMm) {
      const theta = this.calculateTheta(radiusMm);

      return 2 * filmThicknessMm * Math.cos(theta);
    }

    calculatePointValues(radiusMm, wavelengthNm, filmThicknessMm) {
      const wavelengthMm = wavelengthNm * 1e-6;
      const theta = this.calculateTheta(radiusMm);
      const opticalPathDifference = this.calculateOpticalPathDifference(radiusMm, filmThicknessMm);
      const intensity = this.calculateIntensity(radiusMm, wavelengthNm, filmThicknessMm);

      return {
        radiusMm,
        theta,
        thetaDeg: theta * 180 / Math.PI,
        opticalPathDifference,
        fringeOrder: opticalPathDifference / wavelengthMm,
        intensity
      };
    }

    draw() {
      const { wavelengthNm, filmThicknessMm } = this.getParameters();
      const width = this.canvas.width;
      const height = this.canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const imageData = this.ctx.createImageData(width, height);
      const pixels = imageData.data;

      this.updateLabels(wavelengthNm, filmThicknessMm);

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const dx = x - centerX;
          const dy = y - centerY;
          const radiusMm = Math.sqrt(dx * dx + dy * dy);
          const intensity = this.calculateIntensity(radiusMm, wavelengthNm, filmThicknessMm);
          const gray = Math.round(intensity * 255);
          const index = (y * width + x) * 4;

          pixels[index] = gray;
          pixels[index + 1] = gray;
          pixels[index + 2] = gray;
          pixels[index + 3] = 255;
        }
      }

      this.ctx.putImageData(imageData, 0, 0);
      this.dispatchParameterEvent();
    }

    updateLabels(wavelengthNm, filmThicknessMm) {
      const wavelengthMm = wavelengthNm * 1e-6;
      const edgeRadiusMm = this.canvas.width / 2;
      const centerValues = this.calculatePointValues(0, wavelengthNm, filmThicknessMm);
      const edgeValues = this.calculatePointValues(edgeRadiusMm, wavelengthNm, filmThicknessMm);

      this.wavelengthValue.textContent = wavelengthNm.toFixed(0);
      this.filmThicknessValue.textContent = filmThicknessMm.toFixed(5);
      this.setReadout("lambdaMm", wavelengthMm.toFixed(6));
      this.setReadout("focalLength", this.config.focalLengthMm.toFixed(0));
      this.setReadout("opdCenter", centerValues.opticalPathDifference.toFixed(6));
      this.setReadout("formulaOpdCenter", centerValues.opticalPathDifference.toFixed(6));
      this.setReadout("centerIntensity", centerValues.intensity.toFixed(3));
      this.setReadout("thetaEdge", edgeValues.thetaDeg.toFixed(2));
      this.setReadout("opdEdge", edgeValues.opticalPathDifference.toFixed(6));
      this.setReadout("fringeOrderCenter", centerValues.fringeOrder.toFixed(2));
      this.setReadout("edgeIntensity", edgeValues.intensity.toFixed(3));
    }

    setReadout(name, value) {
      if (this.readouts[name]) {
        this.readouts[name].textContent = value;
      }
    }

    setReadyState(isReady) {
      this.root.dataset.nusepReady = String(isReady);
    }

    dispatchLifecycleEvent(state) {
      this.root.dispatchEvent(new CustomEvent("nusep:experiment-lifecycle", {
        detail: {
          experiment: "michelson-interferometer",
          state,
          parameters: this.getParameters()
        }
      }));
    }

    dispatchParameterEvent() {
      this.root.dispatchEvent(new CustomEvent("nusep:parameters-change", {
        detail: this.getParameters()
      }));
    }
  }

  function createMichelsonInterferometer(config) {
    return new MichelsonInterferometer(config).init();
  }

  window.MichelsonInterferometer = MichelsonInterferometer;
  window.createMichelsonInterferometer = createMichelsonInterferometer;

  document.addEventListener("DOMContentLoaded", () => {
    window.michelsonInterferometer = createMichelsonInterferometer();
  });
})();
