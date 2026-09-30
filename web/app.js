/* Maine Historical Atlas — map application.
 * Loads data/sites.json + data/maine-boundary.geojson, renders era-colored
 * markers, settlement shading overlays, and an era filter panel.
 * No build step: plain Leaflet + vanilla JS.
 */
(function () {
  'use strict';

  var DATA_URL = 'data/sites.json';
  var BOUNDARY_URL = 'data/maine-boundary.geojson';

  var SHADING_STYLE = {
    settled:     { color: '#b45309', weight: 2, fillColor: '#d97706', fillOpacity: 0.28 },
    contested:   { color: '#c2410c', weight: 2, dashArray: '8 6', fillColor: '#ea580c', fillOpacity: 0.22 },
    uncontrolled:{ color: '#475569', weight: 2, dashArray: '3 5', fillColor: '#64748b', fillOpacity: 0.16 }
  };

  var SHADING_LABEL = {
    settled: 'Colonist-settled',
    contested: 'Contested / disputed',
    uncontrolled: 'Out of colonial control'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function kindLabel(kind) {
    return kind.replace(/-/g, ' ');
  }

  function yearRange(site) {
    if (site.start_year && site.end_year && site.start_year !== site.end_year) {
      return site.start_year + '–' + site.end_year;
    }
    return site.start_year ? String(site.start_year) : '';
  }

  function popupHtml(site, eraLabel) {
    var years = yearRange(site);
    return (
      '<div class="popup-kind">' + esc(kindLabel(site.kind)) + '</div>' +
      '<h3 class="popup-title">' + esc(site.name) + '</h3>' +
      '<p class="popup-era">' + esc(eraLabel) + (years ? ' · ' + esc(years) : '') + '</p>' +
      '<p class="popup-summary">' + esc(site.summary) + '</p>' +
      '<a class="popup-wiki" href="' + esc(site.wikipedia) + '" target="_blank" rel="noopener noreferrer">' +
      'Read on Wikipedia \u2192</a>'
    );
  }

  function initMap(data, boundary) {
    var map = L.map('map', { scrollWheelZoom: true }).setView([45.25, -69.4], 7);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Accurate modern state boundary.
    var boundaryLayer = L.geoJSON(boundary, {
      style: { color: '#1e3a8a', weight: 2.5, fill: false }
    }).addTo(map);
    map.fitBounds(boundaryLayer.getBounds().pad(0.08));

    var erasById = {};
    data.eras.forEach(function (e) { erasById[e.id] = e; });

    // ---- Site markers, grouped per era for filtering ----
    var eraLayers = {};
    var eraCounts = {};
    data.eras.forEach(function (e) {
      eraLayers[e.id] = L.layerGroup().addTo(map);
      eraCounts[e.id] = 0;
    });

    data.sites.forEach(function (site) {
      var era = erasById[site.era];
      if (!era) return; // dataset QA should prevent this; stay defensive
      var marker = L.circleMarker([site.lat, site.lng], {
        radius: 7,
        color: '#1c1917',
        weight: 1.5,
        fillColor: era.color,
        fillOpacity: 0.9
      }).bindPopup(popupHtml(site, era.label), { maxWidth: 320 });
      marker.addTo(eraLayers[site.era]);
      eraCounts[site.era] += 1;
    });

    // ---- Settlement shading overlays ----
    var shadingLayer = L.layerGroup().addTo(map);
    data.settlement_shading.forEach(function (sh) {
      var style = SHADING_STYLE[sh.status] || SHADING_STYLE.uncontrolled;
      var latlngs = sh.polygon.map(function (p) { return [p[0], p[1]]; });
      L.polygon(latlngs, style)
        .bindTooltip('<strong>' + esc(sh.label) + '</strong><br>' + esc(sh.note || ''), { sticky: true })
        .addTo(shadingLayer);
    });

    buildEraPanel(data.eras, eraLayers, eraCounts, map);
    buildShadingLegend(data.settlement_shading, shadingLayer, map);
  }

  function buildEraPanel(eras, eraLayers, eraCounts, map) {
    var list = document.getElementById('era-list');
    list.innerHTML = '';
    eras.forEach(function (era) {
      var row = el('label', 'era-row');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('aria-label', 'Show ' + era.label + ' sites');
      box.addEventListener('change', function () {
        if (box.checked) {
          eraLayers[era.id].addTo(map);
        } else {
          map.removeLayer(eraLayers[era.id]);
        }
      });
      var dot = el('span', 'era-dot');
      dot.style.backgroundColor = era.color;
      var label = el('span', 'era-label', era.label);
      var count = el('span', 'era-count', String(eraCounts[era.id] || 0) + ' sites');
      row.appendChild(box);
      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(count);
      row.title = era.summary || '';
      list.appendChild(row);
    });
  }

  function buildShadingLegend(shading, shadingLayer, map) {
    var legend = document.getElementById('shading-legend');
    legend.innerHTML = '';
    var seen = {};
    shading.forEach(function (sh) {
      if (seen[sh.status]) return;
      seen[sh.status] = true;
      var li = el('li');
      var sw = el('span', 'swatch');
      var st = SHADING_STYLE[sh.status] || SHADING_STYLE.uncontrolled;
      sw.style.backgroundColor = st.fillColor;
      sw.style.opacity = '0.85';
      if (st.dashArray) sw.style.borderStyle = 'dashed';
      li.appendChild(sw);
      li.appendChild(el('span', null, SHADING_LABEL[sh.status] || sh.status));
      legend.appendChild(li);
    });
    var toggle = document.getElementById('shading-checkbox');
    toggle.addEventListener('change', function () {
      if (toggle.checked) {
        shadingLayer.addTo(map);
      } else {
        map.removeLayer(shadingLayer);
      }
    });
  }

  function initPanelToggle() {
    var btn = document.getElementById('panel-toggle');
    var panel = document.getElementById('side-panel');
    btn.addEventListener('click', function () {
      var collapsed = panel.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  function fail(msg) {
    var mapDiv = document.getElementById('map');
    mapDiv.innerHTML = '<div style="padding:2rem;font-family:sans-serif">' +
      '<h2>Couldn\u2019t load the atlas data</h2><p>' + esc(msg) + '</p></div>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    initPanelToggle();
    Promise.all([
      fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('sites.json: ' + r.status); return r.json(); }),
      fetch(BOUNDARY_URL).then(function (r) { if (!r.ok) throw new Error('maine-boundary.geojson: ' + r.status); return r.json(); })
    ]).then(function (results) {
      initMap(results[0], results[1]);
    }).catch(function (err) {
      fail('The data files could not be loaded. Serve this folder over HTTP (e.g. `python3 -m http.server`) — browsers block local file reads.');
      if (window.console) console.error(err);
    });
  });
})();
