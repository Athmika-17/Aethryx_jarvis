import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GibsLayerSpec, RegionLocation } from '../types/earth';

export type GlobeInteractionMode = 'select' | 'bbox' | 'polygon';

interface EarthGlobeProps {
  region: RegionLocation;
  activeLayer: GibsLayerSpec | null;
  layerDate: string;
  autoRotate: boolean;
  drawMode?: GlobeInteractionMode;
  draftPolygonVertices?: Array<[number, number]>;
  zoomCommand?: { type: 'in' | 'out' | 'reset'; seq: number } | null;
  onSelectCoordinates?: (lat: number, lon: number) => void;
  onCompleteBbox?: (bbox: [number, number, number, number]) => void;
  onAddPolygonVertex?: (lat: number, lon: number) => void;
  className?: string;
}

const _vec3 = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();

function latLonToVec3(lat: number, lon: number, radius: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  const sinPhi = Math.sin(phi);
  out.set(
    -radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  );
  return out;
}

function vec3ToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  const r = point.length() || 1;
  const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(point.y / r, -1, 1)));
  let theta = Math.atan2(point.z, -point.x);
  if (theta < 0) theta += Math.PI * 2;
  const lon = THREE.MathUtils.radToDeg(theta) - 180;
  return {
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
  };
}

/** Subdivide edge segments so bounding boxes and polygons hug the spherical globe cleanly */
function buildCurvedLoopPoints(
  lonLatRing: Array<[number, number]>,
  radius: number,
  stepsPerEdge = 10,
): THREE.Vector3[] {
  if (lonLatRing.length < 2) return [];
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < lonLatRing.length; i++) {
    const [lonA, latA] = lonLatRing[i];
    const [lonB, latB] = lonLatRing[(i + 1) % lonLatRing.length];
    for (let s = 0; s < stepsPerEdge; s++) {
      const t = s / stepsPerEdge;
      pts.push(latLonToVec3(latA + (latB - latA) * t, lonA + (lonB - lonA) * t, radius, new THREE.Vector3()));
    }
  }
  return pts;
}

function createProceduralFallbackEarthTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0a1f3d');
  grad.addColorStop(0.5, '#07162e');
  grad.addColorStop(1, '#0a1f3d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const EarthGlobe: React.FC<EarthGlobeProps> = ({
  region,
  activeLayer,
  layerDate,
  autoRotate,
  drawMode = 'select',
  draftPolygonVertices = [],
  zoomCommand,
  onSelectCoordinates,
  onCompleteBbox,
  onAddPolygonVertex,
  className = '',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [layerLoadStatus, setLayerLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hoverCoords, setHoverCoords] = useState<{ lat: number; lon: number } | null>(null);

  const onSelectRef = useRef(onSelectCoordinates);
  onSelectRef.current = onSelectCoordinates;

  const onCompleteBboxRef = useRef(onCompleteBbox);
  onCompleteBboxRef.current = onCompleteBbox;

  const onAddPolyRef = useRef(onAddPolygonVertex);
  onAddPolyRef.current = onAddPolygonVertex;

  const drawModeRef = useRef<GlobeInteractionMode>(drawMode);
  drawModeRef.current = drawMode;

  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const sceneRefs = useRef<{
    camera?: THREE.PerspectiveCamera;
    controls?: OrbitControls;
    overlayMesh?: THREE.Mesh;
    markerGroup?: THREE.Group;
    bboxLine?: THREE.LineLoop;
    polygonLine?: THREE.LineLoop;
    draftLine?: THREE.LineLoop;
    flyToPos?: THREE.Vector3 | null;
    renderer?: THREE.WebGLRenderer;
    requestRender?: () => void;
    isSoftwareGl?: boolean;
  }>({});

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#040710');

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    latLonToVec3(region.lat, region.lon, 3.1, _targetCamPos);
    camera.position.copy(_targetCamPos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.45;
    controls.maxDistance = 5.5;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.8;
    controls.autoRotate = !isSoftwareGl && autoRotateRef.current;
    controls.autoRotateSpeed = 0.4;

    // Lighting rig
    const hemi = new THREE.HemisphereLight(0xbbe6ff, 0x0c192f, 1.35);
    scene.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xfff5e4, 2.2);
    sunLight.position.set(5, 3, 4);
    scene.add(sunLight);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-5, -2, -4);
    scene.add(rimLight);

    // Starfield
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 18 + Math.random() * 25;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x94a3b8, size: 0.08, sizeAttenuation: true });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Earth Base Sphere
    const earthGeo = new THREE.SphereGeometry(1, 72, 48);
    const fallbackTex = createProceduralFallbackEarthTexture();
    const earthMat = new THREE.MeshStandardMaterial({
      map: fallbackTex,
      roughness: 0.78,
      metalness: 0.05,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMesh.layers.enable(1);
    scene.add(earthMesh);

    const texLoader = new THREE.TextureLoader();
    texLoader.load(
      '/api/gibs/image?layer=BlueMarble_ShadedRelief_Bathymetry&width=1024&height=512',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        earthMat.map = tex;
        earthMat.needsUpdate = true;
        fallbackTex.dispose();
        setLayerLoadStatus('ready');
        requestRender();
      },
      undefined,
      () => {
        setLayerLoadStatus('error');
        requestRender();
      },
    );

    // Scientific Data Layer Overlay Sphere
    const overlayGeo = new THREE.SphereGeometry(1.004, 72, 48);
    const overlayMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      visible: false,
    });
    const overlayMesh = new THREE.Mesh(overlayGeo, overlayMat);
    scene.add(overlayMesh);

    // Subtle Lat/Lon Graticule
    const gratPoints: THREE.Vector3[] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 6) {
        gratPoints.push(latLonToVec3(lat, lon, 1.007), latLonToVec3(lat, lon + 6, 1.007));
      }
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -84; lat < 84; lat += 6) {
        gratPoints.push(latLonToVec3(lat, lon, 1.007), latLonToVec3(lat + 6, lon, 1.007));
      }
    }
    const gratGeo = new THREE.BufferGeometry().setFromPoints(gratPoints);
    const gratMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
    });
    const graticule = new THREE.LineSegments(gratGeo, gratMat);
    scene.add(graticule);

    // Atmosphere Fresnel Rim Shell
    const atmosGeo = new THREE.SphereGeometry(1.06, 48, 32);
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.66 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
          gl_FragColor = vec4(0.14, 0.75, 0.96, 1.0) * intensity * 0.65;
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    scene.add(atmosMesh);

    // Selected Location Marker Group
    const markerGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.016, 0.025, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    const coreGeo = new THREE.SphereGeometry(0.011, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const stemGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.065, 8);
    const stemMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const stemMesh = new THREE.Mesh(stemGeo, stemMat);
    stemMesh.position.z = 0.032;
    stemMesh.rotation.x = Math.PI / 2;
    markerGroup.add(ringMesh, coreMesh, stemMesh);
    scene.add(markerGroup);

    // Region Bounding Box Loop (Amber)
    const bboxGeo = new THREE.BufferGeometry();
    const bboxMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.95 });
    const bboxLine = new THREE.LineLoop(bboxGeo, bboxMat);
    scene.add(bboxLine);

    // Custom Finalized Polygon Loop (Cyan)
    const polygonGeo = new THREE.BufferGeometry();
    const polygonMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.95 });
    const polygonLine = new THREE.LineLoop(polygonGeo, polygonMat);
    polygonLine.visible = false;
    scene.add(polygonLine);

    // Draft Interactive BBox / Polygon Loop (Emerald)
    const draftGeo = new THREE.BufferGeometry();
    const draftMat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.95 });
    const draftLine = new THREE.LineLoop(draftGeo, draftMat);
    draftLine.visible = false;
    scene.add(draftLine);

    sceneRefs.current = {
      camera,
      controls,
      overlayMesh,
      markerGroup,
      bboxLine,
      polygonLine,
      draftLine,
      flyToPos: null,
      renderer,
      isSoftwareGl,
    };

    // Raycasting for Click-to-Select, BBox Drag, Polygon Vertex Add & Hover Coordinates
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let lastMove = 0;
    let bboxStart: { lat: number; lon: number } | null = null;

    const updatePointer = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const raycastGlobe = (ev: PointerEvent) => {
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(earthMesh, false);
      return hits.length > 0 ? vec3ToLatLon(hits[0].point) : null;
    };

    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
      if (drawModeRef.current === 'bbox') {
        const hit = raycastGlobe(ev);
        if (hit) {
          bboxStart = hit;
        }
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (drawModeRef.current === 'bbox' && bboxStart) {
        const end = raycastGlobe(ev);
        const start = bboxStart;
        bboxStart = null;
        draftLine.visible = false;
        requestRender();
        if (end && onCompleteBboxRef.current) {
          const minLat = Number(Math.min(start.lat, end.lat).toFixed(4));
          const maxLat = Number(Math.max(start.lat, end.lat).toFixed(4));
          const minLon = Number(Math.min(start.lon, end.lon).toFixed(4));
          const maxLon = Number(Math.max(start.lon, end.lon).toFixed(4));
          if (Math.abs(maxLat - minLat) >= 0.15 && Math.abs(maxLon - minLon) >= 0.15) {
            onCompleteBboxRef.current([minLon, minLat, maxLon, maxLat]);
          }
        }
        return;
      }

      const dist = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      if (dist > 5) return; // Dragged camera
      const hit = raycastGlobe(ev);
      if (!hit) return;

      if (drawModeRef.current === 'polygon' && onAddPolyRef.current) {
        onAddPolyRef.current(hit.lat, hit.lon);
      } else if (onSelectRef.current) {
        onSelectRef.current(hit.lat, hit.lon);
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (drawModeRef.current === 'bbox' && bboxStart) {
        const cur = raycastGlobe(ev);
        if (cur) {
          setHoverCoords(cur);
          const minLon = Math.min(bboxStart.lon, cur.lon);
          const maxLon = Math.max(bboxStart.lon, cur.lon);
          const minLat = Math.min(bboxStart.lat, cur.lat);
          const maxLat = Math.max(bboxStart.lat, cur.lat);
          const pts = buildCurvedLoopPoints(
            [
              [minLon, minLat],
              [maxLon, minLat],
              [maxLon, maxLat],
              [minLon, maxLat],
            ],
            1.013,
            8,
          );
          draftLine.geometry.dispose();
          draftLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          draftLine.visible = true;
          requestRender();
        }
        return;
      }

      const now = Date.now();
      if (now - lastMove < 60) return;
      lastMove = now;
      const hit = raycastGlobe(ev);
      if (hit) {
        setHoverCoords(hit);
        renderer.domElement.style.cursor = 'crosshair';
      } else {
        setHoverCoords(null);
        renderer.domElement.style.cursor = drawModeRef.current === 'bbox' ? 'crosshair' : 'grab';
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;
    let lastFrameTs = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function stepAndRender() {
      const now = performance.now();
      const delta = Math.min(Math.max(0.001, (now - lastFrameTs) / 1000), 0.1);
      lastFrameTs = now;
      const flyTarget = sceneRefs.current.flyToPos;
      if (flyTarget) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, flyTarget.x, 4.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, flyTarget.y, 4.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, flyTarget.z, 4.5, delta);
        if (camera.position.distanceTo(flyTarget) < 0.015) {
          sceneRefs.current.flyToPos = null;
        }
      }
      controls.autoRotate =
        !isSoftwareGl &&
        autoRotateRef.current &&
        drawModeRef.current === 'select' &&
        !sceneRefs.current.flyToPos;
      controls.update();
      renderer.render(scene, camera);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        stepAndRender();
        const done = () => {
          renderBusy = false;
          if (
            renderDirty ||
            sceneRefs.current.flyToPos ||
            (!isSoftwareGl && autoRotateRef.current && drawModeRef.current === 'select')
          ) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    sceneRefs.current.requestRender = requestRender;

    controls.addEventListener('start', () => {
      sceneRefs.current.flyToPos = null;
    });
    controls.addEventListener('change', () => {
      requestRender();
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(200, entry.contentRect.width);
      const h = Math.max(200, entry.contentRect.height);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      overlayGeo.dispose();
      overlayMat.dispose();
      gratGeo.dispose();
      gratMat.dispose();
      atmosGeo.dispose();
      atmosMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      stemGeo.dispose();
      stemMat.dispose();
      bboxGeo.dispose();
      bboxMat.dispose();
      polygonGeo.dispose();
      polygonMat.dispose();
      draftGeo.dispose();
      draftMat.dispose();
      renderer.dispose();
    };
  }, []);

  // Disable OrbitControls rotation when actively dragging a BBox rectangle
  useEffect(() => {
    const { controls, requestRender } = sceneRefs.current;
    if (!controls || !requestRender) return;
    controls.enableRotate = drawMode !== 'bbox';
    requestRender();
  }, [drawMode]);

  // Update selected region marker, bounding box, custom polygon & camera flight
  useEffect(() => {
    const { markerGroup, bboxLine, polygonLine, camera, requestRender } = sceneRefs.current;
    if (!markerGroup || !bboxLine || !polygonLine || !camera || !requestRender) return;

    latLonToVec3(region.lat, region.lon, 1.012, _vec3);
    markerGroup.position.copy(_vec3);
    markerGroup.lookAt(_vec3.clone().multiplyScalar(2));

    const bb = region.bbox ?? [
      region.lon - 0.6,
      region.lat - 0.6,
      region.lon + 0.6,
      region.lat + 0.6,
    ];
    const [w, s, e, n] = bb;
    const pts = buildCurvedLoopPoints(
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
      ],
      1.011,
      8,
    );
    bboxLine.geometry.dispose();
    bboxLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);

    if (region.polygon && region.polygon.length >= 3) {
      const polyPts = buildCurvedLoopPoints(region.polygon, 1.013, 8);
      polygonLine.geometry.dispose();
      polygonLine.geometry = new THREE.BufferGeometry().setFromPoints(polyPts);
      polygonLine.visible = true;
    } else {
      polygonLine.visible = false;
    }

    const dist = THREE.MathUtils.clamp(camera.position.length(), 2.2, 3.3);
    sceneRefs.current.flyToPos = latLonToVec3(region.lat, region.lon, dist, new THREE.Vector3());
    requestRender();
  }, [region.lat, region.lon, region.bbox, region.polygon]);

  // Update interactive draft polygon preview
  useEffect(() => {
    const { draftLine, requestRender } = sceneRefs.current;
    if (!draftLine || !requestRender) return;
    if (drawMode === 'polygon' && draftPolygonVertices.length >= 2) {
      const pts = buildCurvedLoopPoints(draftPolygonVertices, 1.014, 6);
      draftLine.geometry.dispose();
      draftLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      draftLine.visible = true;
    } else {
      draftLine.visible = false;
    }
    requestRender();
  }, [drawMode, draftPolygonVertices]);

  // Update autoRotate toggle
  useEffect(() => {
    sceneRefs.current.requestRender?.();
  }, [autoRotate]);

  // Handle zoom commands
  useEffect(() => {
    if (!zoomCommand) return;
    const { camera, requestRender } = sceneRefs.current;
    if (!camera || !requestRender) return;
    const curDist = camera.position.length();
    let nextDist = curDist;
    if (zoomCommand.type === 'in') nextDist = Math.max(1.55, curDist * 0.78);
    if (zoomCommand.type === 'out') nextDist = Math.min(5.2, curDist * 1.25);
    if (zoomCommand.type === 'reset') nextDist = 3.1;
    sceneRefs.current.flyToPos = latLonToVec3(region.lat, region.lon, nextDist, new THREE.Vector3());
    requestRender();
  }, [zoomCommand, region.lat, region.lon]);

  // Load NASA GIBS Scientific Overlay Layer
  useEffect(() => {
    const { overlayMesh, renderer, requestRender } = sceneRefs.current;
    if (!overlayMesh || !renderer || !requestRender) return;
    const mat = overlayMesh.material as THREE.MeshBasicMaterial;

    if (!activeLayer || activeLayer.category === 'base') {
      mat.visible = false;
      if (mat.map) {
        mat.map.dispose();
        mat.map = null;
      }
      mat.needsUpdate = true;
      setLayerLoadStatus('ready');
      requestRender();
      return;
    }

    let cancelled = false;
    setLayerLoadStatus('loading');
    const url = `/api/gibs/image?layer=${encodeURIComponent(activeLayer.layerName)}&date=${encodeURIComponent(layerDate || activeLayer.defaultDate)}&width=1024&height=512`;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (mat.map) mat.map.dispose();
        mat.map = tex;
        mat.visible = true;
        mat.needsUpdate = true;
        setLayerLoadStatus('ready');
        requestRender();
      },
      undefined,
      () => {
        if (!cancelled) {
          mat.visible = false;
          setLayerLoadStatus('error');
          requestRender();
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [activeLayer, layerDate]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[#040710] ${className}`}>
      <div ref={mountRef} className="w-full h-full" aria-label="Interactive 3D Earth Globe" />
      <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-3 text-xs font-mono text-slate-300 bg-[#060913]/90 border border-slate-800 px-3 py-1.5 rounded-md">
        <span className="tabular-nums">
          Target: {Math.abs(region.lat).toFixed(2)}°{region.lat >= 0 ? 'N' : 'S'}, {Math.abs(region.lon).toFixed(2)}°{region.lon >= 0 ? 'E' : 'W'}
        </span>
        {hoverCoords && (
          <>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <span className="text-cyan-300 tabular-nums">
              Cursor: {hoverCoords.lat.toFixed(2)}°, {hoverCoords.lon.toFixed(2)}°
            </span>
          </>
        )}
        <span className="text-slate-600" aria-hidden="true">|</span>
        <span className={layerLoadStatus === 'error' ? 'text-amber-400' : 'text-slate-400'}>
          {layerLoadStatus === 'loading'
            ? 'Loading NASA GIBS...'
            : layerLoadStatus === 'error'
              ? 'GIBS layer unavailable for date'
              : drawMode === 'bbox'
                ? 'Drag across globe to draw bounding box'
                : drawMode === 'polygon'
                  ? `Click vertices (${draftPolygonVertices.length} placed)`
                  : 'Click globe to select region'}
        </span>
      </div>
    </div>
  );
};
