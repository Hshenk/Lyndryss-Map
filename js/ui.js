/**
 * ui.js — wires DOM controls to the other modules. All element ids, classes,
 * and templates referenced here exist in index.html.
 *
 * Elements / hooks cheat sheet:
 *   #sidebar-toggle        → toggle .sidebar--collapsed on #sidebar,
 *                            mirror state to aria-expanded
 *   #zoom-in / #zoom-out   → renderer.zoomBy(ZOOM_STEP) / (1 / ZOOM_STEP)
 *   #zoom-reset            → renderer.resetView()
 *   #coords-readout        → update on canvas pointermove ("123, -456")
 *   #marker-search         → markers.searchMarkers() on input; results into
 *                            #search-results via template #tpl-search-result;
 *                            remove .is-hidden while there are results
 *   #overlay-toggle-list   → change events on .switch__input[data-layer]
 *                            → layers.setLayerVisible(); disable inputs whose
 *                            layer isn't in the manifest
 *   #icon-toggle-list      → rebuild from markers.getCategories() using
 *                            template #tpl-icon-toggle (set data-category,
 *                            .switch__icon src, .switch__label, .switch__count)
 *   #icons-show-all/#icons-hide-all → set every category switch + state
 *   #tool-place-icon / #tool-place-note → exclusive toggle: .is-active +
 *                            aria-pressed, body.is-placing while a tool is
 *                            armed (crosshair cursor)
 *   #annotation-icon-palette → .is-selected on the picked swatch (data-icon)
 *   #annotation-clear      → confirm(), then annotations.clearAnnotations()
 *   #popup-layer           → popups appended here; templates
 *                            #tpl-marker-popup / #tpl-note-popup
 *   #loading-overlay       → add .is-hidden once first render succeeds
 *   #error-banner          → showError() below; #error-banner-dismiss re-hides
 *   #map-updated / #map-version → fill from manifest
 */


import { ZOOM_STEP } from "./config.js";
import { overlayPalette } from "./map-data.js";
import { setActiveOverlay, getActiveOverlay, setCategoryVisible, isCategoryVisible, 
  setRiversVisible, setRoutesVisible, setLabelsVisible } from "./layers.js";
import { getCategories, getCategoryCount, getCategoryIcon, searchMarkers } from "./markers.js";
import { updateAnnotation, removeAnnotation, clearAnnotations } from "./annotations.js";


/**
 * @typedef {Object} UIState
 * @property {"pan" | "icon" | "note"} activeTool
 * @property {string} selectedIcon  data-icon of the selected palette swatch
 */
let renderer = null;
const state = {
  activeTool: "pan", 
  selectedIcon: "flag",
};


/** @returns {UIState} current tool state (renderer click handling reads this) */
export function getUIState() {
  return { ...state };
}

export function setActiveTool(tool) {
  state.activeTool = tool;
  for (const b of document.querySelectorAll(".tool-btn")) {
    const active = b.dataset.tool === tool;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  document.body.classList.toggle("is-placing", tool !== "pan");
}


/**
 * Bind every control. Call once from main.js after data + renderer exist.
 * @param {import("./renderer.js").Renderer} renderer
 */
export function initUI(r) {
  renderer = r;
  bindSidebarToggle();
  bindZoomControls();
  bindMapModes();
  buildIconToggles();
  buildLegend();
  bindBulkButtons();
  bindAnnotationTools();
  bindFeatureToggles();
  bindSearch();
  bindErrorDismiss();
}


function bindSidebarToggle() {
  const button = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  button.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("sidebar--collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
  });
}

// When we try to zoom the webpage, send that instead to our zoom function
function bindZoomControls(){
  document.getElementById("zoom-in").addEventListener("click", () => {
    renderer.zoomSmooth(ZOOM_STEP);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    renderer.zoomSmooth(1 / ZOOM_STEP);
  });
  document.getElementById("zoom-reset").addEventListener("click", () => {
    renderer.resetView();
  });
}

function popupLayer() {
  return document.getElementById("popup-layer");
}

/** Close any open popup. */
export function closePopups() {
  popupLayer().replaceChildren();
}


function positionPopup(popup, sx, sy){
  const bounds = popupLayer().getBoundingClientRect();
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  const left = Math.min(Math.max(8, sx + 16), bounds.width - w - 8);
  const top = Math.min(Math.max(8, sy - h / 2), bounds.height - h - 8);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}


/**
 * Open a marker popup near a screen point (clamp so it stays in-viewport).
 * @param {import("./markers.js").Marker} marker
 * @param {number} sx screen px (canvas-relative)
 * @param {number} sy screen px
 */
export function openMarkerPopup(marker, sx, sy) {
  closePopups();
  const fragment = document.getElementById("tpl-marker-popup").content.cloneNode(true);
  const popup = fragment.querySelector(".popup");
  popup.querySelector(".popup__title").textContent = marker.name;
  popup.querySelector(".popup__body").textContent = marker.note ?? "";

  const link = popup.querySelector(".popup__link");
  if (marker.link) {
    link.href = marker.link;
    link.classList.remove("is-hidden");
  }


  popup.querySelector(".popup__close").addEventListener("click", closePopups);
  popupLayer().append(popup);
  positionPopup(popup, sx, sy);
}

/**
 * Open the editable note popup for a (new or existing) annotation.
 * @param {import("./annotations.js").Annotation} annotation
 * @param {number} sx screen px
 * @param {number} sy screen px
 */
export function openNotePopup(annotation, sx, sy) {
  closePopups();
  const fragment = document.getElementById("tpl-note-popup").content.cloneNode(true);
  const popup = fragment.querySelector(".popup");
  const textarea = popup.querySelector(".popup__textarea");
  textarea.value = annotation.text ?? "";

  popup.querySelector(".popup__close").addEventListener("click", closePopups);
  popup.querySelector(".popup__save").addEventListener("click", () => {
    updateAnnotation(annotation.id, { text: textarea.value });
    closePopups();
  });
  popup.querySelector(".popup__delete").addEventListener("click", () => {
    removeAnnotation(annotation.id);
    closePopups();
    renderer.render();
  });

  popupLayer().append(popup);
  positionPopup(popup, sx, sy);
  textarea.focus();
}




function bindErrorDismiss() {
  document.getElementById("error-banner-dismiss").addEventListener("click", () => {
    document.getElementById("error-banner").classList.add("is-hidden");
  });
}

/**
 * Show the error banner with a message.
 * @param {string} message
 */
export function showError(message) {
  document.getElementById("error-banner-text").textContent = message;
  document.getElementById("error-banner").classList.remove("is-hidden");
}


function bindMapModes() {
  const buttons = document.querySelectorAll("#map-mode-list .map-mode");
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      setActiveOverlay(btn.dataset.mode);

      // Move the highlight box to the clicked button (mutually exclusive).
      for (const b of buttons) {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      }
      buildLegend();
    });
  }
}

/** Fill legend-list with the active map-mode's palette or the marker key if none */
function buildLegend() {
  const list = document.getElementById("legend-list");
  const overlay = getActiveOverlay();
  if (!overlay || overlay === "biome" || overlay === "province") return buildMarkerLegend(list);
  if (overlay === "heightmap") return buildHeightLegend(list);

  const entries = Object.entries(overlayPalette(overlay))
    .filter(([id]) => id !== "0")
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  
  list.replaceChildren();
  for (const [, { name, color }] of entries) {
    const li = document.createElement("li");
    li.className = "legend-list__item";
    li.innerHTML = 
      `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;` +
      `background:${color};margin-right:8px;vertical-align:middle"></span><span></span>`;
    li.lastElementChild.textContent = name;
    list.appendChild(li)
  }
}


/** The default legend */
function buildMarkerLegend(list) {
  list.replaceChildren();
  for (const cat of getCategories()) {
    const li = document.createElement("li");
    li.className = "legend-list__item";
    li.innerHTML = `<img src="${cat.icon}" alt="" width="16" height="16"><span></span>`;
    li.lastElementChild.textContent = cat.name;
    list.appendChild(li);
  }
}

function buildHeightLegend(list) {
  list.replaceChildren();
  const li = document.createElement("li");
  li.className = "legend-list__item";
  li.innerHTML =
  `<div style="flex:1">
      <div style="height:10px;border-radius:3px;background:linear-gradient(to right,` +
      `rgb(70,96,168),rgb(76,145,190),rgb(96,190,170),rgb(170,212,120),rgb(240,238,165),rgb(242,165,80),rgb(214,72,50),rgb(112,20,52))"></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:2px">` +
      `<span>Low</span><span>High</span></div></div>`;
  list.appendChild(li);
}


function buildIconToggles() {
  const list = document.getElementById("icon-toggle-list");
  const template = document.getElementById("tpl-icon-toggle");
  list.replaceChildren();

  for (const category of getCategories()) {
    const row = template.content.cloneNode(true);
    const input = row.querySelector(".switch__input");
    input.dataset.category = category.id;
    input.checked = isCategoryVisible(category.id);
    row.querySelector(".switch__icon").src = category.icon;
    row.querySelector(".switch__label").textContent = category.name;
    row.querySelector(".switch__count").textContent = getCategoryCount(category.id);

    input.addEventListener("change", () =>{
      setCategoryVisible(category.id, input.checked);
    });
    list.append(row);
  }
}

function bindBulkButtons() {
  const setAll = (checked) => {
    const inputs = document.querySelectorAll("#icon-toggle-list .switch__input");
    for (const input of inputs) {
      input.checked = checked;
      setCategoryVisible(input.dataset.category, checked);
    }
  };
  document.getElementById("icons-show-all").addEventListener("click", () => setAll(true));
  document.getElementById("icons-hide-all").addEventListener("click", () => setAll(false));
}


function bindFeatureToggles() {
  for (const input of document.querySelectorAll("#feature-toggle-list .switch__input")) {
    input.addEventListener("change", () => {
      const f = input.dataset.feature;
      if (f === "rivers") setRiversVisible(input.checked);
      else if (f === "routes") setRoutesVisible(input.checked);
      else if (f === "labels") setLabelsVisible(input.checked);
    });
  }
}


// ---------- Search functions ---------- 
function bindSearch() {
  const input = document.getElementById("marker-search");
  const resultsList = document.getElementById("search-results");
  const template = document.getElementById("tpl-search-result");

  input.addEventListener("input", () => {
    const matches = searchMarkers(input.value);
    resultsList.replaceChildren();
    resultsList.classList.toggle("is-hidden", matches.length === 0);

    for (const marker of matches) {
      const row = template.content.cloneNode(true);
      const button = row.querySelector(".search-result__btn");
      button.dataset.markerId = marker.id;
      row.querySelector(".search-result__icon").src = getCategoryIcon(marker.category);
      row.querySelector(".search-result__name").textContent = marker.name;

      button.addEventListener("click", () => {
        renderer.view.x = marker.x;
        renderer.view.y = marker.y;
        if (renderer.view.scale < 1) renderer.view.scale = 1;
        renderer.render();
        resultsList.classList.add("is-hidden");
        input.value = "";
      });
      resultsList.append(row);
    }
  });


  // Hide the dropdown on Escape
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") resultsList.classList.add("is-hidden")
  });
}

// ---------- Annotation functions ---------- 
function bindAnnotationTools() {
  const toolButtons = [
    document.getElementById("tool-place-icon"),
    document.getElementById("tool-place-note"),
  ];

  for (const button of toolButtons) {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      setActiveTool(state.activeTool === tool ? "pan" : tool);
    });
  }

  // Exit tool with escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setActiveTool("pan");
      closePopups();
    }
  });''

  // Icon palette 
  const swatches = document.querySelectorAll("#annotation-icon-palette .icon-palette__swatch");
  for (const swatch of swatches) {
    swatch.addEventListener("click", () => {
      state.selectedIcon = swatch.dataset.icon;
      for (const s of swatches) {
        s.classList.toggle("is-selected", s === swatch);
      }
    });
  }
  swatches[0]?.classList.add("is-selected"); // Default matches state.selectedIcon

  // Warning when trying to clear all annotations
  document.getElementById("annotation-clear").addEventListener("click", () => {
    if (confirm("Remove all of your markers and notes from the browser?")) {
      clearAnnotations();
      closePopups();
      renderer.render();
    }
  });
}
