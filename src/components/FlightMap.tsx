import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import { feature, mesh } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  buildPredictionWorldPoints,
  buildTrailWorldPoints,
  projectAirport,
  projectToWorld
} from "../utils/geo";
import type { FlightDetail, FlightSummary } from "../types/flight";

const atlas = worldAtlas as unknown as {
  objects: {
    countries: object;
  };
};

const countriesData = feature(
  atlas as never,
  atlas.objects.countries as never
) as unknown as GeoJSON.FeatureCollection;
const countryBorders = mesh(
  atlas as never,
  atlas.objects.countries as never,
  (left: { id?: string | number }, right: { id?: string | number }) => left.id !== right.id
) as unknown as GeoJSON.MultiLineString;

interface FlightMapProps {
  flights: FlightSummary[];
  selectedFlight: FlightSummary | null;
  selectedDetail: FlightDetail | null;
  onSelectFlight: (flight: FlightSummary) => void;
  refreshing: boolean;
}

interface ProjectedFlight extends FlightSummary {
  worldX: number;
  worldY: number;
}

interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  flightPoints: THREE.Points;
  flightGeometry: THREE.BufferGeometry;
  raycaster: THREE.Raycaster;
  selectedMarker: THREE.Group;
  originMarker: THREE.Group;
  destinationMarker: THREE.Group;
  trailLine: THREE.Line;
  projectionLine: THREE.Line;
  routeCursor: THREE.Mesh;
  routeAnimationPoints: THREE.Vector3[];
  projectedFlights: ProjectedFlight[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toneColor(tone: FlightSummary["tone"]): THREE.ColorRepresentation {
  switch (tone) {
    case "ground":
      return "#ffd36d";
    case "climbing":
    case "descending":
      return "#81d5fa";
    case "approach":
      return "#ff7e83";
    default:
      return "#5ef4cd";
  }
}

function buildProjection(): GeoProjection {
  return geoNaturalEarth1()
    .fitExtent(
      [
        [20, 24],
        [MAP_WIDTH - 20, MAP_HEIGHT - 24]
      ],
      { type: "Sphere" }
    )
    .precision(0.1);
}

function createDotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create point texture");
  }

  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 28);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);

  return new THREE.CanvasTexture(canvas);
}

function createMapTexture(projection: GeoProjection): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_WIDTH * 2;
  canvas.height = MAP_HEIGHT * 2;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create map texture");
  }

  context.scale(2, 2);
  context.fillStyle = "rgba(2, 10, 16, 0.98)";
  context.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  const path = geoPath(projection, context);

  context.beginPath();
  path(geoGraticule10());
  context.strokeStyle = "rgba(129, 213, 250, 0.07)";
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  path(countriesData);
  context.fillStyle = "rgba(180, 198, 214, 0.10)";
  context.fill();

  context.beginPath();
  path(countryBorders);
  context.strokeStyle = "rgba(129, 213, 250, 0.18)";
  context.lineWidth = 1.15;
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createMarker(color: number): THREE.Group {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4.2, 6.4, 36),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    })
  );
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95
    })
  );

  group.add(ring);
  group.add(core);
  group.visible = false;
  return group;
}

function createSelectedMarker(): THREE.Group {
  const group = new THREE.Group();
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(6.8, 8.2, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    })
  );
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    })
  );
  group.add(outer);
  group.add(inner);
  group.visible = false;
  return group;
}

function clampCamera(camera: THREE.OrthographicCamera) {
  const viewWidth = (camera.right - camera.left) / camera.zoom;
  const viewHeight = (camera.top - camera.bottom) / camera.zoom;
  const maxX = Math.max(0, MAP_WIDTH / 2 - viewWidth / 2);
  const maxY = Math.max(0, MAP_HEIGHT / 2 - viewHeight / 2);
  camera.position.x = clamp(camera.position.x, -maxX, maxX);
  camera.position.y = clamp(camera.position.y, -maxY, maxY);
}

function updateCameraFrustum(camera: THREE.OrthographicCamera, width: number, height: number) {
  const aspect = width / height;
  camera.left = (-MAP_HEIGHT * aspect) / 2;
  camera.right = (MAP_HEIGHT * aspect) / 2;
  camera.top = MAP_HEIGHT / 2;
  camera.bottom = -MAP_HEIGHT / 2;
  clampCamera(camera);
  camera.updateProjectionMatrix();
}

function updateLine(line: THREE.Line, points: THREE.Vector3[], dashed = false) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points);
  if (dashed) {
    line.computeLineDistances();
  }
}

export function FlightMap({
  flights,
  selectedFlight,
  selectedDetail,
  onSelectFlight,
  refreshing
}: FlightMapProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<SceneBundle | null>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerX: 0,
    pointerY: 0
  });

  const projection = useMemo(() => buildProjection(), []);
  const projectedFlights = useMemo(
    () =>
      flights
        .map((flight) => {
          const worldPoint = projectToWorld(projection, flight.longitude, flight.latitude);

          if (!worldPoint) {
            return null;
          }

          return {
            ...flight,
            worldX: worldPoint.x,
            worldY: worldPoint.y
          };
        })
        .filter((flight): flight is ProjectedFlight => flight !== null),
    [flights, projection]
  );

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;

    if (!frame || !canvas) {
      return undefined;
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-MAP_WIDTH / 2, MAP_WIDTH / 2, MAP_HEIGHT / 2, -MAP_HEIGHT / 2, 1, 2000);
    camera.position.set(0, 0, 500);
    camera.zoom = 1.08;

    const mapTexture = createMapTexture(projection);
    const mapMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT),
      new THREE.MeshBasicMaterial({
        map: mapTexture,
        transparent: true
      })
    );
    scene.add(mapMesh);

    const flightGeometry = new THREE.BufferGeometry();
    const flightMaterial = new THREE.PointsMaterial({
      size: 8.5,
      transparent: true,
      opacity: 0.95,
      map: createDotTexture(),
      vertexColors: true,
      depthWrite: false,
      sizeAttenuation: false
    });
    const flightPoints = new THREE.Points(flightGeometry, flightMaterial);
    scene.add(flightPoints);

    const trailLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x5ef4cd,
        transparent: true,
        opacity: 0.82
      })
    );
    const projectionLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: 0x81d5fa,
        dashSize: 14,
        gapSize: 8,
        transparent: true,
        opacity: 0.68
      })
    );
    trailLine.visible = false;
    projectionLine.visible = false;
    scene.add(trailLine);
    scene.add(projectionLine);

    const selectedMarker = createSelectedMarker();
    const originMarker = createMarker(0x5ef4cd);
    const destinationMarker = createMarker(0x81d5fa);
    const routeCursor = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 24, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92
      })
    );
    routeCursor.visible = false;

    scene.add(selectedMarker);
    scene.add(originMarker);
    scene.add(destinationMarker);
    scene.add(routeCursor);

    const raycaster = new THREE.Raycaster();
    const keyboardState = new Set<string>();

    const bundle: SceneBundle = {
      renderer,
      scene,
      camera,
      flightPoints,
      flightGeometry,
      raycaster,
      selectedMarker,
      originMarker,
      destinationMarker,
      trailLine,
      projectionLine,
      routeCursor,
      routeAnimationPoints: [],
      projectedFlights: []
    };

    sceneRef.current = bundle;

    const resize = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      renderer.setSize(width, height, false);
      updateCameraFrustum(camera, width, height);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    resize();

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.00135), 1, 18);
      clampCamera(camera);
      camera.updateProjectionMatrix();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      keyboardState.add(event.code);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      keyboardState.delete(event.code);
    };

    const handlePointerDown = (event: PointerEvent) => {
      dragRef.current.active = true;
      dragRef.current.moved = false;
      dragRef.current.pointerX = event.clientX;
      dragRef.current.pointerY = event.clientY;
      frame.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current.active) {
        return;
      }

      const deltaX = event.clientX - dragRef.current.pointerX;
      const deltaY = event.clientY - dragRef.current.pointerY;

      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        dragRef.current.moved = true;
      }

      const viewWidth = (camera.right - camera.left) / camera.zoom;
      const viewHeight = (camera.top - camera.bottom) / camera.zoom;
      camera.position.x -= (deltaX / frame.clientWidth) * viewWidth;
      camera.position.y += (deltaY / frame.clientHeight) * viewHeight;
      clampCamera(camera);
      camera.updateProjectionMatrix();

      dragRef.current.pointerX = event.clientX;
      dragRef.current.pointerY = event.clientY;
    };

    const selectFromPointer = (event: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      raycaster.params.Points = {
        threshold: 12 / camera.zoom
      };
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObject(flightPoints);
      const matchIndex = intersections[0]?.index;

      if (matchIndex === undefined) {
        return;
      }

      const flight = sceneRef.current?.projectedFlights[matchIndex];
      if (flight) {
        onSelectFlight(flight);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!dragRef.current.active) {
        return;
      }

      if (!dragRef.current.moved) {
        selectFromPointer(event);
      }

      dragRef.current.active = false;
      frame.releasePointerCapture(event.pointerId);
    };

    frame.addEventListener("wheel", handleWheel, { passive: false });
    frame.addEventListener("pointerdown", handlePointerDown);
    frame.addEventListener("pointermove", handlePointerMove);
    frame.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const clock = new THREE.Clock();
    let frameId = 0;

    const animate = () => {
      const delta = clock.getDelta();
      const moveSpeed = 220 / camera.zoom;

      if (keyboardState.has("KeyW")) {
        camera.position.y += moveSpeed * delta;
      }
      if (keyboardState.has("KeyS")) {
        camera.position.y -= moveSpeed * delta;
      }
      if (keyboardState.has("KeyA")) {
        camera.position.x -= moveSpeed * delta;
      }
      if (keyboardState.has("KeyD")) {
        camera.position.x += moveSpeed * delta;
      }

      clampCamera(camera);
      camera.updateProjectionMatrix();

      const markerScale = 1 / camera.zoom;
      selectedMarker.scale.setScalar(markerScale);
      originMarker.scale.setScalar(markerScale);
      destinationMarker.scale.setScalar(markerScale);
      routeCursor.scale.setScalar(markerScale);

      if (bundle.routeAnimationPoints.length > 1) {
        const progress = (clock.elapsedTime * 0.25) % 1;
        const segment = progress * (bundle.routeAnimationPoints.length - 1);
        const baseIndex = Math.floor(segment);
        const nextIndex = Math.min(baseIndex + 1, bundle.routeAnimationPoints.length - 1);
        const alpha = segment - baseIndex;
        const from = bundle.routeAnimationPoints[baseIndex];
        const to = bundle.routeAnimationPoints[nextIndex];

        routeCursor.position.set(
          THREE.MathUtils.lerp(from.x, to.x, alpha),
          THREE.MathUtils.lerp(from.y, to.y, alpha),
          4
        );
        routeCursor.visible = true;
      } else {
        routeCursor.visible = false;
      }

      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      frame.removeEventListener("wheel", handleWheel);
      frame.removeEventListener("pointerdown", handlePointerDown);
      frame.removeEventListener("pointermove", handlePointerMove);
      frame.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      flightGeometry.dispose();
      flightMaterial.dispose();
      mapTexture.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };
  }, [onSelectFlight, projection]);

  useEffect(() => {
    const bundle = sceneRef.current;

    if (!bundle) {
      return;
    }

    const positions = new Float32Array(projectedFlights.length * 3);
    const colors = new Float32Array(projectedFlights.length * 3);
    const color = new THREE.Color();

    projectedFlights.forEach((flight, index) => {
      const offset = index * 3;
      positions[offset] = flight.worldX;
      positions[offset + 1] = flight.worldY;
      positions[offset + 2] = 2;

      color.set(toneColor(flight.tone));
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    });

    bundle.flightGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    bundle.flightGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    bundle.flightGeometry.computeBoundingSphere();
    bundle.projectedFlights = projectedFlights;
  }, [projectedFlights]);

  useEffect(() => {
    const bundle = sceneRef.current;

    if (!bundle) {
      return;
    }

    if (!selectedFlight) {
      bundle.selectedMarker.visible = false;
      return;
    }

    const projected = projectedFlights.find((flight) => flight.id === selectedFlight.id);

    if (!projected) {
      bundle.selectedMarker.visible = false;
      return;
    }

    bundle.selectedMarker.position.set(projected.worldX, projected.worldY, 5);
    bundle.selectedMarker.visible = true;
  }, [projectedFlights, selectedFlight]);

  useEffect(() => {
    const bundle = sceneRef.current;

    if (!bundle) {
      return;
    }

    if (!selectedDetail) {
      bundle.trailLine.visible = false;
      bundle.projectionLine.visible = false;
      bundle.originMarker.visible = false;
      bundle.destinationMarker.visible = false;
      bundle.routeCursor.visible = false;
      bundle.routeAnimationPoints = [];
      return;
    }

    const trailPoints = buildTrailWorldPoints(selectedDetail, projection).map(
      (point) => new THREE.Vector3(point.x, point.y, 3)
    );
    const predictionPoints = buildPredictionWorldPoints(selectedDetail, projection).map(
      (point) => new THREE.Vector3(point.x, point.y, 2.5)
    );

    if (trailPoints.length > 1) {
      updateLine(bundle.trailLine, trailPoints);
      bundle.trailLine.visible = true;
    } else {
      bundle.trailLine.visible = false;
    }

    if (predictionPoints.length > 1) {
      updateLine(bundle.projectionLine, predictionPoints, true);
      bundle.projectionLine.visible = true;
    } else {
      bundle.projectionLine.visible = false;
    }

    const animatedPoints = trailPoints.length > 1 ? trailPoints : predictionPoints;
    bundle.routeAnimationPoints = animatedPoints;

    const origin = projectAirport(projection, selectedDetail.origin.longitude, selectedDetail.origin.latitude);
    const destination = projectAirport(projection, selectedDetail.destination.longitude, selectedDetail.destination.latitude);

    if (origin) {
      bundle.originMarker.position.set(origin.x, origin.y, 4);
      bundle.originMarker.visible = true;
    } else {
      bundle.originMarker.visible = false;
    }

    if (destination) {
      bundle.destinationMarker.position.set(destination.x, destination.y, 4);
      bundle.destinationMarker.visible = true;
    } else {
      bundle.destinationMarker.visible = false;
    }
  }, [projection, selectedDetail]);

  return (
    <section className="map-shell">
      <header className="map-header">
        <div>
          <p className="eyebrow">World Airspace</p>
          <h2>WebGL tactical flight surface</h2>
        </div>
        <div className="map-actions">
          <span className={refreshing ? "chip chip-live is-refreshing" : "chip chip-live"}>
            {refreshing ? "Refreshing feed" : "Live feed stable"}
          </span>
          <span className="chip">Wheel zoom / WASD pan</span>
        </div>
      </header>

      <div ref={frameRef} className="map-frame map-frame-webgl">
        <canvas ref={canvasRef} className="map-canvas" aria-label="Global live flight map" />

        <div className="map-overlay overlay-top-left">
          <span className="overlay-label">Live density</span>
          <strong>{projectedFlights.length.toLocaleString()} tracks</strong>
        </div>
        <div className="map-overlay overlay-top-right">
          <span className="overlay-label">Controls</span>
          <strong>Wheel / drag / WASD</strong>
        </div>
        <div className="map-overlay overlay-bottom-left">
          <div className="legend">
            <span className="legend-item">
              <i className="legend-dot cruise" />
              Cruise
            </span>
            <span className="legend-item">
              <i className="legend-dot climbing" />
              Climb / Descend
            </span>
            <span className="legend-item">
              <i className="legend-dot ground" />
              Ground
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
