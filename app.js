(function () {
  "use strict";

  const STORAGE_KEY = "nusep.michelson.parameters.v2";

  const DEFAULT_CONFIG = {
    rootId: "michelsonExperiment",
    canvasId: "interferogram"
  };

  const DEFAULT_STATE = {
    wavelengthNm: 550,
    filmThicknessMm: 0.0025,
    focalLengthMm: 200,
    visibility: 1,
    displayMode: "color",
    showGuides: true,
    sampleX: 335,
    sampleY: 205
  };

  const CONTROL_LIMITS = {
    wavelengthNm: { min: 400, max: 700, digits: 0 },
    filmThicknessMm: { min: 0, max: 0.005, digits: 5 },
    focalLengthMm: { min: 80, max: 500, digits: 0 },
    visibilityPercent: { min: 0, max: 100, digits: 0 }
  };

  class MichelsonInterferometer {
    constructor(config = {}) {
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.root = document.getElementById(this.config.rootId);
      this.canvas = document.getElementById(this.config.canvasId);
      this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
      this.state = { ...DEFAULT_STATE, ...this.loadStoredState() };
      this.records = [];
      this.numericBindings = [];
      this.pendingFrame = null;
      this.animationFrame = null;
      this.animationStartedAt = 0;
      this.radii = [];
      this.elements = {};

      this.handleControlInput = this.handleControlInput.bind(this);
      this.handleDisplayModeChange = this.handleDisplayModeChange.bind(this);
      this.handleGuideToggle = this.handleGuideToggle.bind(this);
      this.handleCanvasPointer = this.handleCanvasPointer.bind(this);
      this.toggleAnimation = this.toggleAnimation.bind(this);
      this.animate = this.animate.bind(this);
      this.reset = this.reset.bind(this);
      this.addRecord = this.addRecord.bind(this);
      this.clearRecords = this.clearRecords.bind(this);
      this.exportCsv = this.exportCsv.bind(this);
      this.exportImage = this.exportImage.bind(this);
      this.applyPreset = this.applyPreset.bind(this);
    }

    init() {
      this.collectElements();
      this.validateElements();
      this.buildGeometryCache();
      this.syncControls();
      this.bindEvents();
      this.draw();
      this.setReadyState(true);
      this.dispatchLifecycleEvent("ready");
      return this;
    }

    destroy() {
      this.stopAnimation();
      this.unbindEvents();

      if (this.pendingFrame !== null) {
        cancelAnimationFrame(this.pendingFrame);
        this.pendingFrame = null;
      }

      this.setReadyState(false);
      this.dispatchLifecycleEvent("destroy");
    }

    collectElements() {
      this.elements = {
        wavelengthRange: document.getElementById("wavelength"),
        wavelengthInput: document.getElementById("wavelengthInput"),
        wavelengthValue: document.getElementById("wavelengthValue"),
        filmThicknessRange: document.getElementById("filmThickness"),
        filmThicknessInput: document.getElementById("filmThicknessInput"),
        filmThicknessValue: document.getElementById("filmThicknessValue"),
        focalLengthRange: document.getElementById("focalLength"),
        focalLengthInput: document.getElementById("focalLengthInput"),
        focalLengthSliderValue: document.getElementById("focalLengthSliderValue"),
        visibilityRange: document.getElementById("visibility"),
        visibilityInput: document.getElementById("visibilityInput"),
        visibilityValue: document.getElementById("visibilityValue"),
        displayModeInputs: Array.from(document.querySelectorAll("input[name='displayMode']")),
        showGuides: document.getElementById("showGuides"),
        resetButton: document.getElementById("resetButton"),
        animationButton: document.getElementById("animationButton"),
        recordButton: document.getElementById("recordButton"),
        exportImageButton: document.getElementById("exportImageButton"),
        exportCsvButton: document.getElementById("exportCsvButton"),
        clearRecordsButton: document.getElementById("clearRecordsButton"),
        presetButtons: Array.from(document.querySelectorAll("[data-preset]")),
        displayModeBadge: document.getElementById("displayModeBadge"),
        measurementBody: document.getElementById("measurementBody"),
        emptyRecordRow: document.getElementById("emptyRecordRow"),
        readouts: {
          lambdaMm: document.getElementById("lambdaMmValue"),
          focalLength: document.getElementById("focalLengthValue"),
          opdCenter: document.getElementById("opdCenterValue"),
          formulaOpdCenter: document.getElementById("formulaOpdCenterValue"),
          centerIntensity: document.getElementById("centerIntensityValue"),
          thetaEdge: document.getElementById("thetaEdgeValue"),
          opdEdge: document.getElementById("opdEdgeValue"),
          fringeOrderCenter: document.getElementById("fringeOrderCenterValue"),
          edgeIntensity: document.getElementById("edgeIntensityValue"),
          ringCount: document.getElementById("ringCountValue"),
          sampleRadius: document.getElementById("sampleRadiusValue"),
          sampleTheta: document.getElementById("sampleThetaValue"),
          sampleOpd: document.getElementById("sampleOpdValue"),
          sampleIntensity: document.getElementById("sampleIntensityValue")
        }
      };
    }

    validateElements() {
      const requiredElements = [
        ["experiment root", this.root],
        ["canvas", this.canvas],
        ["canvas context", this.ctx],
        ["wavelength range", this.elements.wavelengthRange],
        ["wavelength input", this.elements.wavelengthInput],
        ["film thickness range", this.elements.filmThicknessRange],
        ["film thickness input", this.elements.filmThicknessInput],
        ["focal length range", this.elements.focalLengthRange],
        ["visibility range", this.elements.visibilityRange],
        ["measurement table", this.elements.measurementBody]
      ];

      const missing = requiredElements
        .filter(([, element]) => !element)
        .map(([name]) => name);

      if (missing.length > 0) {
        throw new Error(`MichelsonInterferometer missing required elements: ${missing.join(", ")}`);
      }
    }

    buildGeometryCache() {
      const width = this.canvas.width;
      const height = this.canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      this.radii = new Float32Array(width * height);

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const dx = x - centerX;
          const dy = y - centerY;
          this.radii[y * width + x] = Math.sqrt(dx * dx + dy * dy);
        }
      }
    }

    bindEvents() {
      this.bindNumericPair(this.elements.wavelengthRange, this.elements.wavelengthInput, "wavelengthNm");
      this.bindNumericPair(this.elements.filmThicknessRange, this.elements.filmThicknessInput, "filmThicknessMm");
      this.bindNumericPair(this.elements.focalLengthRange, this.elements.focalLengthInput, "focalLengthMm");
      this.bindNumericPair(this.elements.visibilityRange, this.elements.visibilityInput, "visibilityPercent");

      this.elements.displayModeInputs.forEach((input) => {
        input.addEventListener("change", this.handleDisplayModeChange);
      });
      this.elements.showGuides.addEventListener("change", this.handleGuideToggle);
      this.canvas.addEventListener("pointermove", this.handleCanvasPointer);
      this.canvas.addEventListener("pointerdown", this.handleCanvasPointer);
      this.elements.resetButton.addEventListener("click", this.reset);
      this.elements.animationButton.addEventListener("click", this.toggleAnimation);
      this.elements.recordButton.addEventListener("click", this.addRecord);
      this.elements.clearRecordsButton.addEventListener("click", this.clearRecords);
      this.elements.exportCsvButton.addEventListener("click", this.exportCsv);
      this.elements.exportImageButton.addEventListener("click", this.exportImage);
      this.elements.presetButtons.forEach((button) => {
        button.addEventListener("click", this.applyPreset);
      });
    }

    unbindEvents() {
      this.numericBindings.forEach(({ range, input, update }) => {
        range.removeEventListener("input", update);
        range.removeEventListener("change", update);
        input.removeEventListener("input", update);
        input.removeEventListener("change", update);
      });
      this.numericBindings = [];

      this.elements.displayModeInputs.forEach((input) => {
        input.removeEventListener("change", this.handleDisplayModeChange);
      });
      this.elements.showGuides.removeEventListener("change", this.handleGuideToggle);
      this.canvas.removeEventListener("pointermove", this.handleCanvasPointer);
      this.canvas.removeEventListener("pointerdown", this.handleCanvasPointer);
      this.elements.resetButton.removeEventListener("click", this.reset);
      this.elements.animationButton.removeEventListener("click", this.toggleAnimation);
      this.elements.recordButton.removeEventListener("click", this.addRecord);
      this.elements.clearRecordsButton.removeEventListener("click", this.clearRecords);
      this.elements.exportCsvButton.removeEventListener("click", this.exportCsv);
      this.elements.exportImageButton.removeEventListener("click", this.exportImage);
      this.elements.presetButtons.forEach((button) => {
        button.removeEventListener("click", this.applyPreset);
      });
    }

    bindNumericPair(range, input, parameterName) {
      const update = (event) => {
        if (event.currentTarget.value === "") {
          return;
        }

        this.stopAnimation();
        const value = Number(event.currentTarget.value);

        if (parameterName === "visibilityPercent") {
          this.state.visibility = this.clamp(value, CONTROL_LIMITS.visibilityPercent) / 100;
        } else {
          this.state[parameterName] = this.clamp(value, CONTROL_LIMITS[parameterName]);
        }

        this.syncControls();
        this.requestDraw();
      };

      range.addEventListener("input", update);
      range.addEventListener("change", update);
      input.addEventListener("input", update);
      input.addEventListener("change", update);
      this.numericBindings.push({ range, input, update });
    }

    handleDisplayModeChange(event) {
      this.state.displayMode = event.currentTarget.value;
      this.syncControls();
      this.requestDraw();
    }

    handleGuideToggle(event) {
      this.state.showGuides = event.currentTarget.checked;
      this.saveState();
      this.requestDraw();
    }

    handleControlInput() {
      this.requestDraw();
    }

    handleCanvasPointer(event) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      this.state.sampleX = this.clamp((event.clientX - rect.left) * scaleX, { min: 0, max: this.canvas.width });
      this.state.sampleY = this.clamp((event.clientY - rect.top) * scaleY, { min: 0, max: this.canvas.height });
      this.requestDraw();
    }

    applyPreset(event) {
      const button = event.currentTarget;
      this.stopAnimation();
      this.setParameters({
        wavelengthNm: Number(button.dataset.wavelength),
        filmThicknessMm: Number(button.dataset.thickness),
        focalLengthMm: Number(button.dataset.focal),
        visibility: Number(button.dataset.visibility) / 100
      });
    }

    reset() {
      this.stopAnimation();
      this.state = { ...DEFAULT_STATE };
      this.syncControls();
      this.draw();
    }

    toggleAnimation() {
      if (this.animationFrame !== null) {
        this.stopAnimation();
        return;
      }

      this.animationStartedAt = performance.now();
      this.elements.animationButton.textContent = "停止扫描";
      this.animationFrame = requestAnimationFrame(this.animate);
    }

    animate(timestamp) {
      const elapsed = timestamp - this.animationStartedAt;
      const period = 6500;
      const progress = (Math.sin((elapsed / period) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      const limit = CONTROL_LIMITS.filmThicknessMm;
      this.state.filmThicknessMm = limit.min + progress * (limit.max - limit.min);
      this.syncControls({ persist: false });
      this.draw();
      this.animationFrame = requestAnimationFrame(this.animate);
    }

    stopAnimation() {
      if (this.animationFrame !== null) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
        this.elements.animationButton.textContent = "扫描膜厚";
        this.saveState();
      }
    }

    requestDraw() {
      if (this.pendingFrame !== null) {
        cancelAnimationFrame(this.pendingFrame);
      }

      this.pendingFrame = requestAnimationFrame(() => {
        this.pendingFrame = null;
        this.draw();
        this.saveState();
      });
    }

    syncControls(options = {}) {
      const persist = options.persist !== false;
      this.state.wavelengthNm = this.clamp(this.state.wavelengthNm, CONTROL_LIMITS.wavelengthNm);
      this.state.filmThicknessMm = this.clamp(this.state.filmThicknessMm, CONTROL_LIMITS.filmThicknessMm);
      this.state.focalLengthMm = this.clamp(this.state.focalLengthMm, CONTROL_LIMITS.focalLengthMm);
      this.state.visibility = this.clamp(this.state.visibility, { min: 0, max: 1 });

      this.setControlValue(this.elements.wavelengthRange, this.state.wavelengthNm, 0);
      this.setControlValue(this.elements.wavelengthInput, this.state.wavelengthNm, 0);
      this.setControlValue(this.elements.filmThicknessRange, this.state.filmThicknessMm, 5);
      this.setControlValue(this.elements.filmThicknessInput, this.state.filmThicknessMm, 5);
      this.setControlValue(this.elements.focalLengthRange, this.state.focalLengthMm, 0);
      this.setControlValue(this.elements.focalLengthInput, this.state.focalLengthMm, 0);
      this.setControlValue(this.elements.visibilityRange, this.state.visibility * 100, 0);
      this.setControlValue(this.elements.visibilityInput, this.state.visibility * 100, 0);

      this.elements.wavelengthValue.textContent = this.state.wavelengthNm.toFixed(0);
      this.elements.filmThicknessValue.textContent = this.state.filmThicknessMm.toFixed(5);
      this.elements.focalLengthSliderValue.textContent = this.state.focalLengthMm.toFixed(0);
      this.elements.visibilityValue.textContent = (this.state.visibility * 100).toFixed(0);
      this.elements.showGuides.checked = this.state.showGuides;
      this.elements.displayModeInputs.forEach((input) => {
        input.checked = input.value === this.state.displayMode;
      });
      this.elements.displayModeBadge.textContent = this.state.displayMode === "color" ? "彩色单色光" : "灰度强度";

      if (persist) {
        this.saveState();
      }
    }

    setControlValue(element, value, digits) {
      element.value = digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
    }

    getParameters() {
      return {
        wavelengthNm: this.state.wavelengthNm,
        filmThicknessMm: this.state.filmThicknessMm,
        focalLengthMm: this.state.focalLengthMm,
        visibility: this.state.visibility,
        displayMode: this.state.displayMode,
        showGuides: this.state.showGuides
      };
    }

    setParameters(parameters = {}) {
      if (Number.isFinite(parameters.wavelengthNm)) {
        this.state.wavelengthNm = parameters.wavelengthNm;
      }
      if (Number.isFinite(parameters.filmThicknessMm)) {
        this.state.filmThicknessMm = parameters.filmThicknessMm;
      }
      if (Number.isFinite(parameters.focalLengthMm)) {
        this.state.focalLengthMm = parameters.focalLengthMm;
      }
      if (Number.isFinite(parameters.visibility)) {
        this.state.visibility = parameters.visibility;
      }
      if (parameters.displayMode === "color" || parameters.displayMode === "gray") {
        this.state.displayMode = parameters.displayMode;
      }
      if (typeof parameters.showGuides === "boolean") {
        this.state.showGuides = parameters.showGuides;
      }

      this.syncControls();
      this.draw();
    }

    calculateTheta(radiusMm, focalLengthMm = this.state.focalLengthMm) {
      return Math.atan(radiusMm / focalLengthMm);
    }

    calculateOpticalPathDifference(radiusMm, filmThicknessMm = this.state.filmThicknessMm, focalLengthMm = this.state.focalLengthMm) {
      const theta = this.calculateTheta(radiusMm, focalLengthMm);
      return 2 * filmThicknessMm * Math.cos(theta);
    }

    calculateIntensity(radiusMm, params = this.getParameters()) {
      const wavelengthMm = params.wavelengthNm * 1e-6;
      const opticalPathDifference = this.calculateOpticalPathDifference(
        radiusMm,
        params.filmThicknessMm,
        params.focalLengthMm
      );
      const phase = (2 * Math.PI * opticalPathDifference) / wavelengthMm;
      const normalizedIntensity = (1 + params.visibility * Math.cos(phase)) / 2;

      return Math.max(0, Math.min(1, normalizedIntensity));
    }

    calculatePointValues(radiusMm, params = this.getParameters()) {
      const wavelengthMm = params.wavelengthNm * 1e-6;
      const theta = this.calculateTheta(radiusMm, params.focalLengthMm);
      const opticalPathDifference = this.calculateOpticalPathDifference(
        radiusMm,
        params.filmThicknessMm,
        params.focalLengthMm
      );
      const intensity = this.calculateIntensity(radiusMm, params);

      return {
        radiusMm,
        theta,
        thetaDeg: theta * 180 / Math.PI,
        opticalPathDifference,
        fringeOrder: opticalPathDifference / wavelengthMm,
        intensity
      };
    }

    getSampleRadius() {
      const centerX = this.canvas.width / 2;
      const centerY = this.canvas.height / 2;
      const dx = this.state.sampleX - centerX;
      const dy = this.state.sampleY - centerY;

      return Math.sqrt(dx * dx + dy * dy);
    }

    draw() {
      const params = this.getParameters();
      const width = this.canvas.width;
      const height = this.canvas.height;
      const imageData = this.ctx.createImageData(width, height);
      const pixels = imageData.data;
      const wavelengthColor = this.wavelengthToRgb(params.wavelengthNm);

      for (let index = 0; index < this.radii.length; index += 1) {
        const intensity = this.calculateIntensity(this.radii[index], params);
        const pixelIndex = index * 4;

        if (params.displayMode === "color") {
          pixels[pixelIndex] = Math.round(wavelengthColor.r * intensity);
          pixels[pixelIndex + 1] = Math.round(wavelengthColor.g * intensity);
          pixels[pixelIndex + 2] = Math.round(wavelengthColor.b * intensity);
        } else {
          const gray = Math.round(intensity * 255);
          pixels[pixelIndex] = gray;
          pixels[pixelIndex + 1] = gray;
          pixels[pixelIndex + 2] = gray;
        }

        pixels[pixelIndex + 3] = 255;
      }

      this.ctx.putImageData(imageData, 0, 0);

      if (params.showGuides) {
        this.drawGuides();
      }

      this.updateReadouts(params);
      this.dispatchParameterEvent();
    }

    drawGuides() {
      const width = this.canvas.width;
      const height = this.canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = this.getSampleRadius();

      this.ctx.save();
      this.ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([5, 7]);
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, 0);
      this.ctx.lineTo(centerX, height);
      this.ctx.moveTo(0, centerY);
      this.ctx.lineTo(width, centerY);
      this.ctx.stroke();

      this.ctx.strokeStyle = "rgba(255, 207, 90, 0.9)";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.setLineDash([]);
      this.ctx.fillStyle = "#ffcf5a";
      this.ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(this.state.sampleX, this.state.sampleY, 6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
    }

    updateReadouts(params) {
      const wavelengthMm = params.wavelengthNm * 1e-6;
      const edgeRadiusMm = this.canvas.width / 2;
      const centerValues = this.calculatePointValues(0, params);
      const edgeValues = this.calculatePointValues(edgeRadiusMm, params);
      const sampleValues = this.calculatePointValues(this.getSampleRadius(), params);
      const ringCount = Math.abs(centerValues.fringeOrder - edgeValues.fringeOrder);

      this.setReadout("lambdaMm", wavelengthMm.toFixed(6));
      this.setReadout("focalLength", params.focalLengthMm.toFixed(0));
      this.setReadout("opdCenter", centerValues.opticalPathDifference.toFixed(6));
      this.setReadout("formulaOpdCenter", centerValues.opticalPathDifference.toFixed(6));
      this.setReadout("centerIntensity", centerValues.intensity.toFixed(3));
      this.setReadout("thetaEdge", edgeValues.thetaDeg.toFixed(2));
      this.setReadout("opdEdge", edgeValues.opticalPathDifference.toFixed(6));
      this.setReadout("fringeOrderCenter", centerValues.fringeOrder.toFixed(2));
      this.setReadout("edgeIntensity", edgeValues.intensity.toFixed(3));
      this.setReadout("ringCount", ringCount.toFixed(2));
      this.setReadout("sampleRadius", sampleValues.radiusMm.toFixed(2));
      this.setReadout("sampleTheta", sampleValues.thetaDeg.toFixed(2));
      this.setReadout("sampleOpd", sampleValues.opticalPathDifference.toFixed(6));
      this.setReadout("sampleIntensity", sampleValues.intensity.toFixed(3));
    }

    setReadout(name, value) {
      const element = this.elements.readouts[name];

      if (element) {
        element.textContent = value;
      }
    }

    addRecord() {
      const params = this.getParameters();
      const centerValues = this.calculatePointValues(0, params);
      const sampleValues = this.calculatePointValues(this.getSampleRadius(), params);
      const row = {
        index: this.records.length + 1,
        wavelengthNm: params.wavelengthNm,
        filmThicknessMm: params.filmThicknessMm,
        focalLengthMm: params.focalLengthMm,
        centerIntensity: centerValues.intensity,
        sampleIntensity: sampleValues.intensity
      };

      this.records.push(row);
      this.renderRecords();
    }

    clearRecords() {
      this.records = [];
      this.renderRecords();
    }

    renderRecords() {
      this.elements.measurementBody.innerHTML = "";

      if (this.records.length === 0) {
        const row = document.createElement("tr");
        row.id = "emptyRecordRow";
        row.innerHTML = '<td colspan="6">暂无记录</td>';
        this.elements.measurementBody.appendChild(row);
        return;
      }

      this.records.forEach((record) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${record.index}</td>
          <td>${record.wavelengthNm.toFixed(0)}</td>
          <td>${record.filmThicknessMm.toFixed(5)}</td>
          <td>${record.focalLengthMm.toFixed(0)}</td>
          <td>${record.centerIntensity.toFixed(3)}</td>
          <td>${record.sampleIntensity.toFixed(3)}</td>
        `;
        this.elements.measurementBody.appendChild(row);
      });
    }

    exportCsv() {
      if (this.records.length === 0) {
        this.addRecord();
      }

      const header = "index,wavelength_nm,film_thickness_mm,focal_length_mm,center_intensity,sample_intensity";
      const rows = this.records.map((record) => [
        record.index,
        record.wavelengthNm.toFixed(0),
        record.filmThicknessMm.toFixed(5),
        record.focalLengthMm.toFixed(0),
        record.centerIntensity.toFixed(6),
        record.sampleIntensity.toFixed(6)
      ].join(","));

      this.downloadBlob([header, ...rows].join("\n"), "michelson_interferometer_records.csv", "text/csv");
    }

    exportImage() {
      const link = document.createElement("a");
      link.download = "michelson_interferogram.png";
      link.href = this.canvas.toDataURL("image/png");
      link.click();
    }

    downloadBlob(content, filename, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }

    wavelengthToRgb(wavelength) {
      let red = 0;
      let green = 0;
      let blue = 0;

      if (wavelength < 440) {
        red = -(wavelength - 440) / 40;
        blue = 1;
      } else if (wavelength < 490) {
        green = (wavelength - 440) / 50;
        blue = 1;
      } else if (wavelength < 510) {
        green = 1;
        blue = -(wavelength - 510) / 20;
      } else if (wavelength < 580) {
        red = (wavelength - 510) / 70;
        green = 1;
      } else if (wavelength < 645) {
        red = 1;
        green = -(wavelength - 645) / 65;
      } else {
        red = 1;
      }

      const factor = wavelength < 420
        ? 0.3 + 0.7 * (wavelength - 400) / 20
        : wavelength > 645
          ? 0.3 + 0.7 * (700 - wavelength) / 55
          : 1;

      return {
        r: Math.round(255 * Math.max(0, red) * factor),
        g: Math.round(255 * Math.max(0, green) * factor),
        b: Math.round(255 * Math.max(0, blue) * factor)
      };
    }

    clamp(value, limits) {
      return Math.min(limits.max, Math.max(limits.min, value));
    }

    saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.getParameters()));
      } catch (error) {
        // Storage can be disabled in embedded platform contexts.
      }
    }

    loadStoredState() {
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));

        if (!stored || typeof stored !== "object") {
          return {};
        }

        return {
          wavelengthNm: Number.isFinite(stored.wavelengthNm) ? stored.wavelengthNm : DEFAULT_STATE.wavelengthNm,
          filmThicknessMm: Number.isFinite(stored.filmThicknessMm) ? stored.filmThicknessMm : DEFAULT_STATE.filmThicknessMm,
          focalLengthMm: Number.isFinite(stored.focalLengthMm) ? stored.focalLengthMm : DEFAULT_STATE.focalLengthMm,
          visibility: Number.isFinite(stored.visibility) ? stored.visibility : DEFAULT_STATE.visibility,
          displayMode: stored.displayMode === "gray" ? "gray" : DEFAULT_STATE.displayMode,
          showGuides: typeof stored.showGuides === "boolean" ? stored.showGuides : DEFAULT_STATE.showGuides
        };
      } catch (error) {
        return {};
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
