const map = L.map("map", {
    center: [-32.1, 115.75],
    zoom: 10,
    zoomControl: true,
});

const basemapOpenStreetMap = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
});

const basemapCartoLight = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
});

const basemapEsriImagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri",
});

basemapEsriImagery.addTo(map);

const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");

const palette = [
    "#0f766e",
    "#be123c",
    "#b45309",
    "#1d4ed8",
    "#6d28d9",
    "#047857",
    "#b91c1c",
    "#4338ca",
    "#9a3412",
    "#166534",
];

proj4.defs("EPSG:32750", "+proj=utm +zone=50 +south +datum=WGS84 +units=m +no_defs +type=crs");
proj4.defs("EPSG:32756", "+proj=utm +zone=56 +south +datum=WGS84 +units=m +no_defs +type=crs");

const GEOGRAPHIC_ALIASES = {
    lat: ["lat", "latitude"],
    lon: ["lon", "lng", "long", "longitude"],
};

const PROJECTED_ALIASES = {
    x: ["x", "easting", "eastings", "utm_e", "utm_x"],
    y: ["y", "northing", "northings", "utm_n", "utm_y"],
};

const overlays = {};
const allPoints = [];
let loadedFiles = 0;

function normalizeHeader(name) {
    return String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderKey(row, aliases) {
    const keys = Object.keys(row || {});
    const normalizedToOriginal = new Map();
    keys.forEach((key) => normalizedToOriginal.set(normalizeHeader(key), key));

    for (const alias of aliases) {
        const found = normalizedToOriginal.get(normalizeHeader(alias));
        if (found) {
            return found;
        }
    }

    return null;
}

function toNumber(value) {
    if (value === undefined || value === null || value === "") {
        return NaN;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
}

function looksLikeLonLat(lon, lat) {
    return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

function getLatLon(row, sourceCRS) {
    const latKey = findHeaderKey(row, GEOGRAPHIC_ALIASES.lat);
    const lonKey = findHeaderKey(row, GEOGRAPHIC_ALIASES.lon);

    if (latKey && lonKey) {
        const lat = toNumber(row[latKey]);
        const lon = toNumber(row[lonKey]);
        if (looksLikeLonLat(lon, lat)) {
            return { lat, lon, mode: "latlon" };
        }
    }

    const xKey = findHeaderKey(row, PROJECTED_ALIASES.x);
    const yKey = findHeaderKey(row, PROJECTED_ALIASES.y);
    if (!xKey || !yKey) {
        return null;
    }

    const x = toNumber(row[xKey]);
    const y = toNumber(row[yKey]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }

    if (looksLikeLonLat(x, y)) {
        return { lat: y, lon: x, mode: "xy-lonlat" };
    }

    const fromCRS = sourceCRS || "EPSG:32750";
    try {
        const converted = proj4(fromCRS, "EPSG:4326", [x, y]);
        return {
            lat: converted[1],
            lon: converted[0],
            mode: `projected-${fromCRS}`,
        };
    } catch (_error) {
        return null;
    }
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function makePopupHtml(fileName, row, coordMode) {
    const hiddenFields = new Set([
        "x",
        "y",
        "lat",
        "lon",
        "lng",
        "latitude",
        "longitude",
        "easting",
        "eastings",
        "northing",
        "northings",
        "year",
        "field_1",
    ]);

    const rows = Object.entries(row)
        .filter(([key, value]) => {
            if (value === undefined || value === null || String(value).trim() === "") {
                return false;
            }
            const normalized = normalizeHeader(key);
            return !hiddenFields.has(normalized);
        })
        .map(([key, value]) => {
            return `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`;
        })
        .join("");

    return `
		<div>
			<strong>${escapeHtml(fileName)}</strong><br />
			<small>Coordinate mode: ${escapeHtml(coordMode)}</small>
			<table class="popup-table">${rows}</table>
		</div>
	`;
}

function updateStatus(text) {
    statusEl.textContent = text;
}

function appendSummary(text, color) {
    const li = document.createElement("li");

    if (color) {
        li.style.setProperty("--dataset-color", color);
        const swatch = document.createElement("span");
        swatch.className = "summary-swatch";
        swatch.style.backgroundColor = color;
        li.appendChild(swatch);
    }

    const content = document.createElement("span");
    content.className = "summary-item-content";
    content.textContent = text;
    li.appendChild(content);

    summaryEl.appendChild(li);
}

function addScaleControl() {
    L.control.scale({
        position: "bottomleft",
        imperial: false,
        metric: true,
    }).addTo(map);
}

function addNorthArrowControl() {
    const NorthArrowControl = L.Control.extend({
        options: { position: "topright" },
        onAdd() {
            const container = L.DomUtil.create("div", "leaflet-bar map-north-arrow");
            container.innerHTML = '<span class="north-n">N</span><span class="north-arrow">↑</span>';
            return container;
        },
    });

    map.addControl(new NorthArrowControl());
}

function addMousePositionControl() {
    const PositionControl = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd() {
            const container = L.DomUtil.create("div", "map-coords-control");
            container.textContent = "Lat: -, Lon: -";
            return container;
        },
    });

    const positionControl = new PositionControl();
    map.addControl(positionControl);

    map.on("mousemove", (event) => {
        const { lat, lng } = event.latlng;
        positionControl.getContainer().textContent = `Lat: ${lat.toFixed(5)}, Lon: ${lng.toFixed(5)}`;
    });

    map.on("mouseout", () => {
        positionControl.getContainer().textContent = "Lat: -, Lon: -";
    });
}

function addCommercialControls() {
    if (L.control.fullscreen) {
        L.control.fullscreen({
            position: "topleft",
            title: "Full screen",
            titleCancel: "Exit full screen",
        }).addTo(map);
    }

    if (L.Control.Draw) {
        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);

        const drawControl = new L.Control.Draw({
            position: "topleft",
            draw: {
                marker: true,
                polygon: true,
                polyline: false,
                rectangle: false,
                circle: false,
                circlemarker: false,
            },
            edit: {
                featureGroup: drawnItems,
            },
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, (event) => {
            drawnItems.addLayer(event.layer);
        });
    }

    if (L.Control.geocoder) {
        L.Control.geocoder({
            defaultMarkGeocode: true,
            placeholder: "Search place",
            position: "topleft",
        }).addTo(map);
    }

    if (L.Control.MiniMap) {
        const miniMapLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        });

        const miniMap = new L.Control.MiniMap(miniMapLayer, {
            position: "bottomright",
            width: 150,
            height: 105,
            toggleDisplay: true,
            minimized: false,
            zoomLevelOffset: -5,
        });
        map.addControl(miniMap);
    }
}

async function loadManifest() {
    const response = await fetch("csvs/manifest.json");
    if (!response.ok) {
        throw new Error(`Could not read csvs/manifest.json (${response.status})`);
    }
    return response.json();
}

function parseCsv(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results),
            error: (error) => reject(error),
        });
    });
}

async function loadOneCsv(entry, colorIndex) {
    const cfg = typeof entry === "string" ? { file: entry } : entry;
    const fileName = cfg.file;
    const sourceCRS = cfg.sourceCRS;
    const label = fileName;
    const color = palette[colorIndex % palette.length];

    const group = L.layerGroup();
    overlays[label] = group;

    const result = await parseCsv(`csvs/${fileName}`);
    const rows = result.data || [];
    let added = 0;

    for (const row of rows) {
        const ll = getLatLon(row, sourceCRS);
        if (!ll) {
            continue;
        }

        const marker = L.circleMarker([ll.lat, ll.lon], {
            radius: 6,
            weight: 1,
            color,
            fillColor: color,
            fillOpacity: 0.9,
        });

        marker.bindPopup(makePopupHtml(fileName, row, ll.mode), {
            maxWidth: 360,
        });

        marker.addTo(group);
        allPoints.push([ll.lat, ll.lon]);
        added += 1;
    }

    if (added > 0) {
        group.addTo(map);
    }

    appendSummary(`${fileName}: ${added} point(s) shown`, color);
    loadedFiles += 1;
    updateStatus(`Loaded ${loadedFiles} / ${manifestLength} files`);
}

let manifestLength = 0;

async function init() {
    try {
        addScaleControl();
        addNorthArrowControl();
        addMousePositionControl();
        addCommercialControls();

        updateStatus("Reading csvs/manifest.json...");
        const manifest = await loadManifest();
        manifestLength = manifest.length;

        for (let i = 0; i < manifest.length; i += 1) {
            await loadOneCsv(manifest[i], i);
        }

        const baseLayers = {
            "OpenStreetMap": basemapOpenStreetMap,
            "CARTO Light": basemapCartoLight,
            "Esri Imagery": basemapEsriImagery,
        };
        L.control.layers(baseLayers, overlays, { collapsed: false }).addTo(map);

        if (allPoints.length > 0) {
            map.fitBounds(L.latLngBounds(allPoints), { padding: [28, 28] });
            updateStatus(`Complete: ${allPoints.length} total point(s) mapped.`);
        } else {
            updateStatus("Complete: no valid coordinates were found in the CSV files.");
        }
    } catch (error) {
        updateStatus(`Error: ${error.message}`);
        appendSummary("Check browser console and ensure you are serving this folder through a local web server.");
        console.error(error);
    }
}

init();
