/* Maine Historical Atlas — map application.
 * Loads data/sites.json + data/maine-boundary.geojson + data/boundary-eras.json,
 * renders era-colored markers, settlement shading overlays, a time slider that
 * redraws historically accurate territorial boundaries/claims for the selected
 * year, and an era filter panel. No build step: plain Leaflet + vanilla JS.
 */
(function () {
  'use strict';

  var DATA_URL = 'data/sites.json';
  var BOUNDARY_URL = 'data/maine-boundary.geojson';
  var BOUNDARY_ERAS_URL = 'data/boundary-eras.json';

  var SHADING_STYLE = {
    settled:  { color: '#b45309', weight: 2, fillColor: '#d97706', fillOpacity: 0.28 },
    contested:{ color: '#c2410c', weight: 2, dashArray: '8 6', fillColor: '#ea580c', fillOpacity: 0.22 },
    disputed: { color: '#7c2d12', weight: 2, dashArray: '8 6', fillColor: '#f59e0b', fillOpacity: 0.22 }
  };

  var SHADING_LABEL = {
    settled: 'Colonist-settled',
    contested: 'Contested / disputed',
    disputed: 'Disputed'
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
    if (site.date_display) return site.date_display;
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

  // ---- Time slider / boundary eras ----

  function eraForYear(eras, year) {
    for (var i = 0; i < eras.length; i++) {
      var e = eras[i];
      var start = (e.start_year === null || e.start_year === undefined) ? -Infinity : e.start_year;
      var end = (e.end_year === null || e.end_year === undefined) ? Infinity : e.end_year;
      if (year >= start && year <= end) return e;
    }
    return eras[eras.length - 1];
  }

  function drawBoundaryEra(map, eraLayer, era) {
    eraLayer.clearLayers();
    (era.layers || []).forEach(function (l) {
      var style = {};
      Object.keys(l.style || {}).forEach(function (k) { style[k] = l.style[k]; });
      if (style.fill === undefined && l.type === 'polygon') style.fill = true;
      var latlngs = l.coords.map(function (p) { return [p[0], p[1]]; }); // [lat, lng]
      var layer = (l.type === 'polyline')
        ? L.polyline(latlngs, style)
        : L.polygon(latlngs, style);
      var tip = '<strong>' + esc(l.label) + '</strong>' +
        (l.note ? '<br>' + esc(l.note) : '');
      layer.bindTooltip(tip, { sticky: true });
      layer.addTo(eraLayer);
    });
  }

  function updateTimeUI(era, year) {
    document.getElementById('time-year').textContent = String(year);
    document.getElementById('time-era').textContent = era.label + ' · ' + era.date_label;
    document.getElementById('time-desc').textContent = era.description + ' ' + era.boundary_note;
    var src = document.getElementById('time-sources');
    src.innerHTML = '';
    (era.sources || []).forEach(function (s, i) {
      if (i > 0) src.appendChild(document.createTextNode(' · '));
      var a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = s.label;
      src.appendChild(a);
    });
  }

  // ---- Visibility: era checkbox + "existed by the selected year" ----

  function siteVisible(site, year, checked) {
    if (!checked[site.era]) return false;
    if (site.start_year !== null && site.start_year !== undefined && site.start_year > year) return false;
    return true;
  }

  function initMap(data, boundary, boundaryEras) {
    var map = L.map('map', { scrollWheelZoom: true }).setView([45.25, -69.4], 7);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Accurate modern state boundary (always shown as reference).
    var boundaryLayer = L.geoJSON(boundary, {
      style: { color: '#1e3a8a', weight: 2.5, fill: false }
    }).addTo(map);
    map.fitBounds(boundaryLayer.getBounds().pad(0.08));

    var erasById = {};
    data.eras.forEach(function (e) { erasById[e.id] = e; });

    // ---- Boundary-era overlay for the time slider ----
    var eraBoundaryLayer = L.layerGroup().addTo(map);

    // ---- Site markers, grouped per era for filtering ----
    var eraLayers = {};
    var eraCounts = {};
    var allMarkers = []; // {marker, site}
    var offmapSites = []; // sites with no single mappable location
    data.eras.forEach(function (e) {
      eraLayers[e.id] = L.layerGroup().addTo(map);
      eraCounts[e.id] = 0;
    });

    data.sites.forEach(function (site) {
      var era = erasById[site.era];
      if (!era) return; // dataset QA should prevent this; stay defensive
      if (site.lat === null || site.lat === undefined || site.lng === null || site.lng === undefined) {
        offmapSites.push(site);
        eraCounts[site.era] += 1;
        return;
      }
      var marker = L.circleMarker([site.lat, site.lng], {
        radius: 7,
        color: '#1c1917',
        weight: 1.5,
        fillColor: era.color,
        fillOpacity: 0.9
      }).bindPopup(popupHtml(site, era.label), { maxWidth: 320 });
      marker.addTo(eraLayers[site.era]);
      allMarkers.push({ marker: marker, site: site });
      eraCounts[site.era] += 1;
    });

    // ---- Settlement shading overlays ----
    var shadingLayer = L.layerGroup().addTo(map);
    data.settlement_shading.forEach(function (sh) {
      var style = SHADING_STYLE[sh.status] || SHADING_STYLE.disputed;
      var latlngs = sh.polygon.map(function (p) { return [p[0], p[1]]; });
      L.polygon(latlngs, style)
        .bindTooltip('<strong>' + esc(sh.label) + '</strong><br>' + esc(sh.note || ''), { sticky: true })
        .addTo(shadingLayer);
    });

    // ---- Shared state + refresh ----
    var state = { year: 2026, checked: {} };
    data.eras.forEach(function (e) { state.checked[e.id] = true; });

    function refresh() {
      // Boundary era for the selected year.
      var bEra = eraForYear(boundaryEras.eras, state.year);
      drawBoundaryEra(map, eraBoundaryLayer, bEra);
      updateTimeUI(bEra, state.year);
      // Markers: era checkbox AND existed by the selected year.
      allMarkers.forEach(function (m) {
        var layer = eraLayers[m.site.era];
        var vis = siteVisible(m.site, state.year, state.checked);
        var onMap = layer.hasLayer(m.marker);
        if (vis && !onMap) m.marker.addTo(layer);
        if (!vis && onMap) layer.removeLayer(m.marker);
      });
      renderOffmapList(offmapSites, erasById, state);
    }

    buildEraPanel(data.eras, eraCounts, state, refresh);
    buildShadingLegend(data.settlement_shading, shadingLayer, map);

    var slider = document.getElementById('time-slider');
    slider.addEventListener('input', function () {
      state.year = parseInt(slider.value, 10);
      refresh();
    });

    refresh();
  }

  function renderOffmapList(sites, erasById, state) {
    var list = document.getElementById('offmap-list');
    list.innerHTML = '';
    var shown = 0;
    sites.forEach(function (site) {
      if (!siteVisible(site, state.year, state.checked)) return;
      shown += 1;
      var era = erasById[site.era];
      var item = el('div', 'offmap-item');
      var dot = el('span', 'era-dot');
      if (era) dot.style.backgroundColor = era.color;
      var head = el('div', 'offmap-head');
      head.appendChild(dot);
      head.appendChild(el('span', 'offmap-name', site.name));
      item.appendChild(head);
      var years = yearRange(site);
      if (years) item.appendChild(el('div', 'offmap-date', years));
      item.appendChild(el('p', 'offmap-summary', site.summary));
      var a = el('a', 'popup-wiki', 'Read on Wikipedia \u2192');
      a.href = site.wikipedia;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      item.appendChild(a);
      list.appendChild(item);
    });
    if (shown === 0) {
      list.appendChild(el('p', 'hint', 'Nothing to show for this date and era selection.'));
    }
  }

  function buildEraPanel(eras, eraCounts, state, refresh) {
    var list = document.getElementById('era-list');
    list.innerHTML = '';
    eras.forEach(function (era) {
      var row = el('label', 'era-row');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('aria-label', 'Show ' + era.label + ' sites');
      box.addEventListener('change', function () {
        state.checked[era.id] = box.checked;
        refresh();
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
      var st = SHADING_STYLE[sh.status] || SHADING_STYLE.disputed;
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
      fetch(BOUNDARY_URL).then(function (r) { if (!r.ok) throw new Error('maine-boundary.geojson: ' + r.status); return r.json(); }),
      fetch(BOUNDARY_ERAS_URL).then(function (r) { if (!r.ok) throw new Error('boundary-eras.json: ' + r.status); return r.json(); })
    ]).then(function (results) {
      initMap(results[0], results[1], results[2]);
    }).catch(function (err) {
      fail('The data files could not be loaded. Serve this folder over HTTP (e.g. `python3 -m http.server`) — browsers block local file reads.');
      if (window.console) console.error(err);
    });
  });
})();
