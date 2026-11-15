import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { InfoDetailMode } from '../coordinate-state';
import { LatLon } from '../core/geo/sphere';
import { formatLatLonShort } from '../moon/physics';
import {
  buildCustomRoverProfile,
  CUSTOM_INSTRUMENT_CATALOG,
  CustomRoverConfig,
  DEFAULT_CUSTOM_ROVER_CONFIG,
  getRoverBeginnerGuide,
  getRoverById,
  NASA_MOON_ROVERS,
  NasaRoverProfile,
  RoverId,
} from '../moon/rovers';

export interface ArticulatedRoverRig {
  group: THREE.Group;
  chassisGroup: THREE.Group;
  leftRocker: THREE.Group;
  rightRocker: THREE.Group;
  leftBogie: THREE.Group;
  rightBogie: THREE.Group;
  wheelMeshes: THREE.Object3D[];
  steeringYokes: THREE.Object3D[];
  updateKinematics: (params: {
    wheelRotationRad: number;
    rockerDifferentialRad: number;
    bogiePitchRad?: number;
    steeringAngleRad?: number;
  }) => void;
}

/**
 * Builds an articulated 4-, 6-, or 8-wheel Rocker-Bogie / Bogie 3D rover model scaled and detailed
 * according to the rover's real or custom physical dimensions, wheel diameter/width, grouser design,
 * power system (MMRTG vs. Solar Arrays), and Remote Sensing Mast.
 */
export function createArticulatedRoverGroup(rover: NasaRoverProfile): ArticulatedRoverRig {
  const root = new THREE.Group();
  root.name = `rover-rig-${rover.id}`;

  const rigType = rover.model3d.rigType;
  const isSolar = /solar/i.test(rover.dimensions.powerSource);

  // Materials
  const bodyGoldMat = new THREE.MeshStandardMaterial({
    color: rigType === 'mer' || rigType === 'sojourner' ? 0xd4a238 : 0xe5dfd3,
    roughness: 0.35,
    metalness: 0.65,
  });
  const whitePaintMat = new THREE.MeshStandardMaterial({
    color: rover.id === 'custom' ? 0xdbeafe : 0xf0eee9,
    roughness: 0.45,
    metalness: 0.25,
  });
  const darkAlloyMat = new THREE.MeshStandardMaterial({
    color: 0x32363d,
    roughness: 0.5,
    metalness: 0.75,
  });
  const titaniumTubeMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ad,
    roughness: 0.35,
    metalness: 0.82,
  });
  const wheelAnodizedMat = new THREE.MeshStandardMaterial({
    color: rigType === 'm2020' ? 0x454a54 : rigType === 'msl' ? 0x353940 : 0x40454d,
    roughness: 0.55,
    metalness: 0.78,
  });
  const grouserMat = new THREE.MeshStandardMaterial({
    color: rover.id === 'custom' ? 0xd8794f : rigType === 'm2020' ? 0xc2b280 : 0x9ca3af,
    roughness: 0.4,
    metalness: 0.85,
  });
  const solarCellMat = new THREE.MeshStandardMaterial({
    color: 0x1d3b6e,
    roughness: 0.25,
    metalness: 0.6,
  });
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x69bdd2,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.6,
    roughness: 0.15,
    metalness: 0.9,
  });
  const rtgFinMat = new THREE.MeshStandardMaterial({
    color: 0xd6d3cd,
    roughness: 0.5,
    metalness: 0.5,
  });

  const scaleFactor =
    rigType === 'sojourner'
      ? 1.35
      : rigType === 'mer'
        ? 0.92
        : 1.0;

  const wheelRadius =
    (rover.wheels.diameterCm / 100 / 2) *
    scaleFactor *
    (rigType === 'sojourner' ? 1.8 : rigType === 'mer' ? 1.35 : 1.0);
  const wheelWidth =
    (rover.wheels.widthCm / 100) * scaleFactor * (rigType === 'sojourner' ? 1.6 : 1.0);
  const halfTrack = rigType === 'sojourner' ? 0.48 : rigType === 'mer' ? 0.68 : 0.95;
  const wheelbaseHalf = rigType === 'sojourner' ? 0.52 : rigType === 'mer' ? 0.72 : 1.08;
  const clearanceY =
    wheelRadius + (rigType === 'sojourner' ? 0.14 : rigType === 'mer' ? 0.22 : 0.34);

  const chassisGroup = new THREE.Group();
  chassisGroup.position.y = clearanceY;
  root.add(chassisGroup);

  // 1. Warm Electronics Box (WEB) / Chassis Body
  const bodyLen = wheelbaseHalf * 1.38;
  const bodyWid = halfTrack * 1.15;
  const bodyHgt = rigType === 'sojourner' ? 0.22 : rigType === 'mer' ? 0.32 : 0.46;

  const webGeo = new THREE.BoxGeometry(bodyWid, bodyHgt, bodyLen);
  const webMesh = new THREE.Mesh(
    webGeo,
    !isSolar ? whitePaintMat : bodyGoldMat,
  );
  chassisGroup.add(webMesh);

  // Gold thermal side panels
  const sidePanelGeo = new THREE.BoxGeometry(bodyWid * 1.02, bodyHgt * 0.72, bodyLen * 0.86);
  const sidePanelMesh = new THREE.Mesh(sidePanelGeo, bodyGoldMat);
  chassisGroup.add(sidePanelMesh);

  // Top Equipment Deck
  const deckGeo = new THREE.BoxGeometry(bodyWid * 1.06, 0.04, bodyLen * 1.04);
  const deckMesh = new THREE.Mesh(deckGeo, darkAlloyMat);
  deckMesh.position.y = bodyHgt / 2 + 0.02;
  chassisGroup.add(deckMesh);

  // 2. Power Source: MMRTG or Solar Panels
  if (!isSolar) {
    const rtgGroup = new THREE.Group();
    rtgGroup.position.set(0, bodyHgt * 0.15, -bodyLen / 2 - 0.32);
    rtgGroup.rotation.x = 0.32;
    const rtgCore = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.68, 12), rtgFinMat);
    rtgCore.rotation.x = Math.PI / 2;
    rtgGroup.add(rtgCore);

    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.62), rtgFinMat);
      fin.position.set(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0);
      fin.rotation.z = angle;
      rtgGroup.add(fin);
    }
    chassisGroup.add(rtgGroup);
  } else if (rigType !== 'sojourner') {
    const centerSolar = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWid * 1.4, 0.025, bodyLen * 1.25),
      solarCellMat,
    );
    centerSolar.position.y = bodyHgt / 2 + 0.045;
    chassisGroup.add(centerSolar);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, bodyLen * 0.95), solarCellMat);
      wing.position.set(side * (bodyWid * 0.7 + 0.26), bodyHgt / 2 + 0.04, -0.05);
      wing.rotation.z = side * -0.06;
      chassisGroup.add(wing);
    }
  } else {
    const sojSolar = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWid * 1.05, 0.025, bodyLen * 1.08),
      solarCellMat,
    );
    sojSolar.position.y = bodyHgt / 2 + 0.04;
    chassisGroup.add(sojSolar);
  }

  // 3. Remote Sensing Mast (RSM) / Pancam Mast + Camera Head
  const mastHeight = rigType === 'sojourner' ? 0.26 : rigType === 'mer' ? 0.68 : 0.92;
  const mastGroup = new THREE.Group();
  mastGroup.position.set(
    rigType === 'sojourner' ? 0 : bodyWid * 0.22,
    bodyHgt / 2,
    bodyLen * 0.32,
  );

  const mastPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.055, mastHeight, 10),
    whitePaintMat,
  );
  mastPost.position.y = mastHeight / 2;
  mastGroup.add(mastPost);

  const camHead = new THREE.Mesh(
    new THREE.BoxGeometry(rigType === 'sojourner' ? 0.18 : 0.34, 0.16, 0.2),
    whitePaintMat,
  );
  camHead.position.y = mastHeight + 0.06;
  mastGroup.add(camHead);

  if (rigType === 'm2020' || rigType === 'msl' || rover.id === 'custom') {
    const cyclopsLens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), lensMat);
    cyclopsLens.rotation.x = Math.PI / 2;
    cyclopsLens.position.set(0, mastHeight + 0.08, 0.1);
    mastGroup.add(cyclopsLens);
  }
  for (const eyeX of [-0.09, 0.09]) {
    const stereoEye = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 10), lensMat);
    stereoEye.rotation.x = Math.PI / 2;
    stereoEye.position.set(eyeX, mastHeight + 0.03, 0.1);
    mastGroup.add(stereoEye);
  }
  chassisGroup.add(mastGroup);

  // 4. Robotic Instrument Arm
  if (rigType !== 'sojourner') {
    const armGroup = new THREE.Group();
    armGroup.position.set(-bodyWid * 0.2, 0, bodyLen / 2 + 0.04);
    const upperBoom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.52, 8),
      titaniumTubeMat,
    );
    upperBoom.position.set(0, 0.08, 0.22);
    upperBoom.rotation.x = Math.PI / 3;
    armGroup.add(upperBoom);

    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(
        rigType === 'mer' ? 0.09 : 0.16,
        rigType === 'mer' ? 0.09 : 0.16,
        0.14,
        12,
      ),
      darkAlloyMat,
    );
    turret.position.set(0, -0.05, 0.44);
    armGroup.add(turret);
    chassisGroup.add(armGroup);
  }

  // 5. High-Gain & UHF Antennas on Aft Deck
  const hgaDish = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.04, 12), bodyGoldMat);
  hgaDish.position.set(-bodyWid * 0.26, bodyHgt / 2 + 0.18, -bodyLen * 0.25);
  hgaDish.rotation.x = 0.25;
  chassisGroup.add(hgaDish);

  const uhfMonopole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8),
    darkAlloyMat,
  );
  uhfMonopole.position.set(bodyWid * 0.32, bodyHgt / 2 + 0.2, -bodyLen * 0.28);
  chassisGroup.add(uhfMonopole);

  // 6. Rocker-Bogie Suspension Hierarchy & 4, 6, or 8 Articulated Wheels
  const leftRocker = new THREE.Group();
  const rightRocker = new THREE.Group();
  const leftBogie = new THREE.Group();
  const rightBogie = new THREE.Group();

  leftRocker.position.set(halfTrack * 0.82, clearanceY + 0.06, 0.15);
  rightRocker.position.set(-halfTrack * 0.82, clearanceY + 0.06, 0.15);
  root.add(leftRocker);
  root.add(rightRocker);

  const wheelMeshes: THREE.Object3D[] = [];
  const steeringYokes: THREE.Object3D[] = [];

  function buildWheelMesh(): THREE.Group {
    const wGroup = new THREE.Group();

    const rimGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 20, 1, false);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMesh = new THREE.Mesh(rimGeo, wheelAnodizedMat);
    wGroup.add(rimMesh);

    const hubGeo = new THREE.CylinderGeometry(
      wheelRadius * 0.28,
      wheelRadius * 0.28,
      wheelWidth * 1.06,
      10,
    );
    hubGeo.rotateZ(Math.PI / 2);
    const hubMesh = new THREE.Mesh(hubGeo, titaniumTubeMat);
    wGroup.add(hubMesh);

    for (let s = 0; s < 6; s++) {
      const sAngle = (s * Math.PI) / 3;
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(wheelWidth * 0.92, wheelRadius * 1.75, 0.022),
        titaniumTubeMat,
      );
      spoke.rotation.x = sAngle;
      wGroup.add(spoke);
    }

    const visualGrousers = rover.wheels.grouserCount >= 40 ? 16 : rover.wheels.grouserCount <= 20 ? 10 : 12;
    for (let g = 0; g < visualGrousers; g++) {
      const theta = (g / visualGrousers) * Math.PI * 2;
      const cleat = new THREE.Mesh(
        new THREE.BoxGeometry(wheelWidth * 1.04, 0.018, rigType === 'm2020' ? 0.02 : 0.028),
        grouserMat,
      );
      cleat.position.set(
        0,
        Math.sin(theta) * (wheelRadius + 0.005),
        Math.cos(theta) * (wheelRadius + 0.005),
      );
      cleat.rotation.x = -theta;
      if (rigType === 'msl' || rover.wheels.grouserCount === 20) {
        cleat.rotation.y = (g % 2 === 0 ? 1 : -1) * 0.18;
      }
      wGroup.add(cleat);
    }

    return wGroup;
  }

  const sides = [
    { sign: 1, rocker: leftRocker, bogie: leftBogie },
    { sign: -1, rocker: rightRocker, bogie: rightBogie },
  ];

  const wheelCount = rover.wheels.count;

  for (const { sign, rocker, bogie } of sides) {
    const outX = sign * (halfTrack * 0.18);
    const frontWheelZ = wheelbaseHalf - 0.15;
    const wheelDropY = -(clearanceY + 0.06 - wheelRadius);

    // Front Rocker Strut & Front Wheel
    const frontStrutLen = Math.hypot(frontWheelZ, wheelDropY);
    const frontStrut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, frontStrutLen, 8),
      titaniumTubeMat,
    );
    frontStrut.position.set(outX * 0.6, wheelDropY / 2, frontWheelZ / 2);
    frontStrut.rotation.x = Math.atan2(frontWheelZ, -wheelDropY);
    rocker.add(frontStrut);

    const frontSteerYoke = new THREE.Group();
    frontSteerYoke.position.set(outX, wheelDropY, frontWheelZ);
    const frontYokePost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.18, 8),
      darkAlloyMat,
    );
    frontYokePost.position.y = 0.12;
    frontSteerYoke.add(frontYokePost);

    const frontWheel = buildWheelMesh();
    frontSteerYoke.add(frontWheel);
    rocker.add(frontSteerYoke);
    steeringYokes.push(frontSteerYoke);
    wheelMeshes.push(frontWheel);

    // If 8 wheels: add a second forward-middle wheel along the front rocker!
    if (wheelCount === 8) {
      const fMidZ = frontWheelZ * 0.34;
      const fMidHolder = new THREE.Group();
      fMidHolder.position.set(outX, wheelDropY, fMidZ);
      const fMidWheel = buildWheelMesh();
      fMidHolder.add(fMidWheel);
      rocker.add(fMidHolder);
      wheelMeshes.push(fMidWheel);
    }

    const bogiePivotZ = -wheelbaseHalf * 0.52;
    const bogiePivotY = wheelDropY * 0.42;
    const rearStrutLen = Math.hypot(bogiePivotZ, bogiePivotY);
    const rearStrut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, rearStrutLen, 8),
      titaniumTubeMat,
    );
    rearStrut.position.set(outX * 0.6, bogiePivotY / 2, bogiePivotZ / 2);
    rearStrut.rotation.x = Math.atan2(bogiePivotZ, -bogiePivotY);
    rocker.add(rearStrut);

    bogie.position.set(outX, bogiePivotY, bogiePivotZ);
    rocker.add(bogie);

    const bogieWheelDropY = wheelDropY - bogiePivotY;
    const midWheelRelZ = wheelbaseHalf * 0.42;
    const rearWheelRelZ = -wheelbaseHalf * 0.56;

    const bogieRelZs = wheelCount === 4 ? [rearWheelRelZ] : [midWheelRelZ, rearWheelRelZ];
    for (const relZ of bogieRelZs) {
      const bLen = Math.hypot(relZ, bogieWheelDropY);
      const bStrut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, bLen, 8),
        titaniumTubeMat,
      );
      bStrut.position.set(0, bogieWheelDropY / 2, relZ / 2);
      bStrut.rotation.x = Math.atan2(relZ, -bogieWheelDropY);
      bogie.add(bStrut);
    }

    if (wheelCount >= 6) {
      const midWheelHolder = new THREE.Group();
      midWheelHolder.position.set(0, bogieWheelDropY, midWheelRelZ);
      const midWheel = buildWheelMesh();
      midWheelHolder.add(midWheel);
      bogie.add(midWheelHolder);
      wheelMeshes.push(midWheel);
    }

    const rearSteerYoke = new THREE.Group();
    rearSteerYoke.position.set(0, bogieWheelDropY, rearWheelRelZ);
    const rearYokePost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.18, 8),
      darkAlloyMat,
    );
    rearYokePost.position.y = 0.12;
    rearSteerYoke.add(rearYokePost);

    const rearWheel = buildWheelMesh();
    rearSteerYoke.add(rearWheel);
    bogie.add(rearSteerYoke);
    steeringYokes.push(rearSteerYoke);
    wheelMeshes.push(rearWheel);
  }

  const updateKinematics = ({
    wheelRotationRad,
    rockerDifferentialRad,
    bogiePitchRad = 0,
    steeringAngleRad = 0,
  }: {
    wheelRotationRad: number;
    rockerDifferentialRad: number;
    bogiePitchRad?: number;
    steeringAngleRad?: number;
  }) => {
    for (const w of wheelMeshes) {
      w.rotation.x = wheelRotationRad;
    }

    leftRocker.rotation.x = rockerDifferentialRad;
    rightRocker.rotation.x = -rockerDifferentialRad;
    leftBogie.rotation.x = bogiePitchRad - rockerDifferentialRad * 0.65;
    rightBogie.rotation.x = -bogiePitchRad + rockerDifferentialRad * 0.65;
    chassisGroup.rotation.z = rockerDifferentialRad * 0.25;

    if (steeringYokes.length === 4) {
      steeringYokes[0].rotation.y = steeringAngleRad;
      steeringYokes[1].rotation.y = -steeringAngleRad;
      steeringYokes[2].rotation.y = steeringAngleRad;
      steeringYokes[3].rotation.y = -steeringAngleRad;
    }
  };

  return {
    group: root,
    chassisGroup,
    leftRocker,
    rightRocker,
    leftBogie,
    rightBogie,
    wheelMeshes,
    steeringYokes,
    updateKinematics,
  };
}

/**
 * Context-Free 3D Perspective Shaded Triangle Renderer on a 2D Canvas.
 */
function renderThreeObjectToCanvas2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rootObj: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
) {
  ctx.fillStyle = '#090C10';
  ctx.fillRect(0, 0, width, height);

  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  rootObj.updateMatrixWorld(true);

  const viewProj = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );

  const projectPoint = (v: THREE.Vector3): { x: number; y: number; z: number } | null => {
    const p = v.clone().applyMatrix4(viewProj);
    if (p.z < -1 || p.z > 1) return null;
    return {
      x: (p.x * 0.5 + 0.5) * width,
      y: (-p.y * 0.5 + 0.5) * height,
      z: p.z,
    };
  };

  // Draw reference grid on y = 0
  ctx.strokeStyle = 'rgba(105, 189, 210, 0.18)';
  ctx.lineWidth = 1;
  const gridHalf = 1.8;
  const gridStep = 0.3;
  for (let g = -gridHalf; g <= gridHalf + 0.01; g += gridStep) {
    const a1 = projectPoint(new THREE.Vector3(g, 0, -gridHalf));
    const a2 = projectPoint(new THREE.Vector3(g, 0, gridHalf));
    if (a1 && a2) {
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.stroke();
    }
    const b1 = projectPoint(new THREE.Vector3(-gridHalf, 0, g));
    const b2 = projectPoint(new THREE.Vector3(gridHalf, 0, g));
    if (b1 && b2) {
      ctx.beginPath();
      ctx.moveTo(b1.x, b1.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();
    }
  }

  interface ProjectedTri {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    depth: number;
    fill: string;
    stroke: string;
  }

  const tris: ProjectedTri[] = [];
  const lightDir1 = new THREE.Vector3(0.55, 0.72, 0.42).normalize();
  const lightDir2 = new THREE.Vector3(-0.5, 0.35, -0.6).normalize();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  let totalIndices = 0;
  rootObj.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      const geom = (node as THREE.Mesh).geometry;
      if (geom) {
        totalIndices += geom.index ? geom.index.count : (geom.attributes.position?.count ?? 0);
      }
    }
  });
  const triStride = totalIndices > 18000 ? Math.ceil(totalIndices / 18000) * 3 : 3;

  rootObj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    if (!posAttr) return;

    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    const baseColor = mat?.color ? mat.color : new THREE.Color(0xd4d4d8);
    const rBase = Math.round(baseColor.r * 255);
    const gBase = Math.round(baseColor.g * 255);
    const bBase = Math.round(baseColor.b * 255);

    const idxAttr = geom.index;
    const count = idxAttr ? idxAttr.count : posAttr.count;
    const step = idxAttr && totalIndices > 18000 ? triStride : 3;

    for (let i = 0; i <= count - 3; i += step) {
      const i0 = idxAttr ? idxAttr.getX(i) : i;
      const i1 = idxAttr ? idxAttr.getX(i + 1) : i + 1;
      const i2 = idxAttr ? idxAttr.getX(i + 2) : i + 2;

      vA.fromBufferAttribute(posAttr, i0).applyMatrix4(mesh.matrixWorld);
      vB.fromBufferAttribute(posAttr, i1).applyMatrix4(mesh.matrixWorld);
      vC.fromBufferAttribute(posAttr, i2).applyMatrix4(mesh.matrixWorld);

      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      cb.cross(ab).normalize();

      const d1 = Math.max(0, cb.dot(lightDir1));
      const d2 = Math.max(0, cb.dot(lightDir2)) * 0.35;
      const shade = Math.min(1.35, 0.38 + d1 * 0.72 + d2);

      const pA = vA.applyMatrix4(viewProj);
      const pB = vB.applyMatrix4(viewProj);
      const pC = vC.applyMatrix4(viewProj);

      if (pA.z < -1 || pA.z > 1 || pB.z < -1 || pB.z > 1 || pC.z < -1 || pC.z > 1) continue;

      const x0 = (pA.x * 0.5 + 0.5) * width;
      const y0 = (-pA.y * 0.5 + 0.5) * height;
      const x1 = (pB.x * 0.5 + 0.5) * width;
      const y1 = (-pB.y * 0.5 + 0.5) * height;
      const x2 = (pC.x * 0.5 + 0.5) * width;
      const y2 = (-pC.y * 0.5 + 0.5) * height;

      const rr = Math.min(255, Math.round(rBase * shade));
      const gg = Math.min(255, Math.round(gBase * shade));
      const bb = Math.min(255, Math.round(bBase * shade));
      const rgb = `rgb(${rr},${gg},${bb})`;

      tris.push({
        x0,
        y0,
        x1,
        y1,
        x2,
        y2,
        depth: (pA.z + pB.z + pC.z) / 3,
        fill: rgb,
        stroke: totalIndices > 18000 ? rgb : 'rgba(9, 12, 16, 0.3)',
      });
    }
  });

  tris.sort((a, b) => b.depth - a.depth);

  ctx.lineWidth = 0.65;
  for (const t of tris) {
    ctx.beginPath();
    ctx.moveTo(t.x0, t.y0);
    ctx.lineTo(t.x1, t.y1);
    ctx.lineTo(t.x2, t.y2);
    ctx.closePath();
    ctx.fillStyle = t.fill;
    ctx.fill();
    ctx.strokeStyle = t.stroke;
    ctx.stroke();
  }
}

/**
 * Interactive SVG Rocker-Bogie Suspension Visual Diagram
 */
const RockerBogieDiagramCard: React.FC<{ rover: NasaRoverProfile }> = ({ rover }) => (
  <div className="tt-card-soft" style={{ padding: '14px 16px' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}
    >
      <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
        How Rocker-Bogie Suspension Climbs lunar Rocks
      </strong>
      <span className="tt-badge green">
        Max Obstacle: {rover.suspension.maxObstacleHeightCm} cm · Clearance:{' '}
        {rover.suspension.groundClearanceCm} cm
      </span>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 14, alignItems: 'center' }}>
      <svg
        viewBox="0 0 240 110"
        style={{
          width: '100%',
          height: '100px',
          background: '#090C10',
          borderRadius: 10,
          border: '1px solid var(--border-color)',
        }}
      >
        <path
          d="M 5 92 L 155 92 L 172 68 L 198 68 L 212 92 L 235 92"
          fill="none"
          stroke="#D8794F"
          strokeWidth="2.5"
        />
        <polygon points="155,92 172,68 198,68 212,92" fill="rgba(216,121,79,0.22)" />
        <rect
          x="72"
          y="26"
          width="78"
          height="24"
          rx="3"
          fill="#151D27"
          stroke="#E8EDF3"
          strokeWidth="1.5"
        />
        <line x1="138" y1="26" x2="138" y2="10" stroke="#E8EDF3" strokeWidth="2.5" />
        <rect x="131" y="6" width="14" height="6" rx="1" fill="#69BDD2" />
        <circle cx="112" cy="40" r="4.5" fill="#269B68" />
        <line x1="112" y1="40" x2="64" y2="56" stroke="#397EBE" strokeWidth="2.5" />
        <circle cx="64" cy="56" r="3.5" fill="#D8794F" />
        <line x1="64" y1="56" x2="36" y2="78" stroke="#397EBE" strokeWidth="2" />
        <line x1="64" y1="56" x2="92" y2="78" stroke="#397EBE" strokeWidth="2" />
        <line x1="112" y1="40" x2="184" y2="54" stroke="#397EBE" strokeWidth="2.5" />
        <circle cx="36" cy="78" r="13" fill="#1C2633" stroke="#E8EDF3" strokeWidth="2" />
        <circle cx="92" cy="78" r="13" fill="#1C2633" stroke="#E8EDF3" strokeWidth="2" />
        <circle cx="184" cy="54" r="13" fill="#1C2633" stroke="#269B68" strokeWidth="2.2" />
      </svg>

      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        <p style={{ marginBottom: 6, color: 'var(--text-primary)' }}>
          Unlike a car with springs, a Moon rover uses a <strong>Rocker-Bogie</strong> seesaw linkage.
          When the front wheel climbs a rock, the central pivot tilts the body by only{' '}
          <strong>half</strong> that angle while keeping all {rover.wheels.count} wheels firmly on the ground.
        </p>
        <div style={{ fontSize: 12 }}>
          Safe operational hill limit: <strong>{rover.mobilityProfile.operationalMaxSlopeDeg}°</strong>
        </div>
      </div>
    </div>
  </div>
);

export interface RoverStudioModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  selectedRoverId: RoverId;
  onSelectRover: (id: RoverId) => void;
  onDeployRoverToLandingSite?: (rover: NasaRoverProfile, coords: LatLon) => void;
  infoMode?: InfoDetailMode;
  experienceMode?: InfoDetailMode;
  initialTab?: 'fleet' | 'custom' | 'compare' | 'overview' | 'engineering' | 'custom_builder';
  customRoverConfig?: CustomRoverConfig;
  onCustomRoverConfigChange?: (cfg: CustomRoverConfig) => void;
  onChangeCustomRoverConfig?: (cfg: CustomRoverConfig) => void;
  routePlan?: unknown;
}

export const RoverStudioModal: React.FC<RoverStudioModalProps> = ({
  open,
  isOpen,
  onClose,
  selectedRoverId,
  onSelectRover,
  onDeployRoverToLandingSite,
  infoMode,
  experienceMode,
  initialTab = 'fleet',
  customRoverConfig = DEFAULT_CUSTOM_ROVER_CONFIG,
  onCustomRoverConfigChange,
  onChangeCustomRoverConfig,
}) => {
  const modalOpen = Boolean(open ?? isOpen);
  const mode: InfoDetailMode = experienceMode ?? infoMode ?? 'beginner';
  const mapTab = (
    t: RoverStudioModalProps['initialTab'],
  ): 'fleet' | 'custom' | 'compare' => {
    if (t === 'custom' || t === 'custom_builder') return 'custom';
    if (t === 'compare') return 'compare';
    return 'fleet';
  };

  const [studioTab, setStudioTab] = useState<'fleet' | 'custom' | 'compare'>(() => mapTab(initialTab));
  const [inspectRoverId, setInspectRoverId] = useState<RoverId>(selectedRoverId);
  const [viewMode, setViewMode] = useState<'articulated_rig' | 'nasa_glb'>('articulated_rig');
  const [autoSpinDrive, setAutoSpinDrive] = useState(true);
  const [suspensionTestDeg, setSuspensionTestDeg] = useState(0);
  const [steeringTestDeg, setSteeringTestDeg] = useState(0);
  const [animateSuspensionWave, setAnimateSuspensionWave] = useState(true);
  const [glbStatus, setGlbStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rigRef = useRef<ArticulatedRoverRig | null>(null);
  const orbitRef = useRef({
    azimuth: 0.78,
    elevation: 0.42,
    distance: 3.8,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  const kinematicsStateRef = useRef({
    autoSpinDrive: true,
    suspensionTestDeg: 0,
    steeringTestDeg: 0,
    animateSuspensionWave: true,
  });

  useEffect(() => {
    if (modalOpen) {
      const mapped = mapTab(initialTab);
      setStudioTab(mapped);
      if (mapped === 'custom') {
        setInspectRoverId('custom');
      } else {
        setInspectRoverId(selectedRoverId);
      }
    }
  }, [modalOpen, initialTab, selectedRoverId]);

  useEffect(() => {
    kinematicsStateRef.current = {
      autoSpinDrive,
      suspensionTestDeg,
      steeringTestDeg,
      animateSuspensionWave,
    };
  }, [autoSpinDrive, suspensionTestDeg, steeringTestDeg, animateSuspensionWave]);

  const customBuiltRover = React.useMemo(
    () => buildCustomRoverProfile(customRoverConfig),
    [customRoverConfig],
  );
  const activeRover =
    studioTab === 'custom' || inspectRoverId === 'custom'
      ? customBuiltRover
      : getRoverById(inspectRoverId, customRoverConfig);

  useEffect(() => {
    if (viewMode === 'nasa_glb' && !activeRover.model3d.glbUrl) {
      setViewMode('articulated_rig');
    }
  }, [activeRover, viewMode]);

  useEffect(() => {
    if (!modalOpen || studioTab === 'compare') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const camera = new THREE.PerspectiveCamera(38, 480 / 300, 0.1, 50);
    const modelHolder = new THREE.Group();
    let disposed = false;

    if (viewMode === 'nasa_glb' && activeRover.model3d.glbUrl) {
      setGlbStatus('loading');
      const fallbackRig = createArticulatedRoverGroup(activeRover);
      modelHolder.add(fallbackRig.group);
      rigRef.current = fallbackRig;

      const loader = new GLTFLoader();
      loader.load(
        activeRover.model3d.glbUrl,
        (gltf) => {
          if (disposed) return;
          while (modelHolder.children.length > 0) {
            modelHolder.remove(modelHolder.children[0]);
          }
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          const maxDim = Math.max(size.x, size.y, size.z, 0.001);
          const targetSpan = 2.35;
          const s = targetSpan / maxDim;
          root.scale.setScalar(s);
          root.position.set(-center.x * s, -box.min.y * s, -center.z * s);
          modelHolder.add(root);
          rigRef.current = null;
          setGlbStatus('loaded');
        },
        undefined,
        () => {
          if (!disposed) setGlbStatus('error');
        },
      );
    } else {
      setGlbStatus('idle');
      const rig = createArticulatedRoverGroup(activeRover);
      modelHolder.add(rig.group);
      rigRef.current = rig;
    }

    let animId = 0;
    let wheelAngle = 0;
    let lastTime = performance.now();
    const startTime = lastTime;

    const animate = (now: number) => {
      if (disposed) return;
      animId = requestAnimationFrame(animate);
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const elapsed = (now - startTime) / 1000;

      const k = kinematicsStateRef.current;
      if (rigRef.current) {
        if (k.autoSpinDrive) {
          wheelAngle += dt * 2.4;
        }
        const waveRad = k.animateSuspensionWave ? Math.sin(elapsed * 1.9) * 0.15 : 0;
        const bogieWaveRad = k.animateSuspensionWave ? Math.cos(elapsed * 2.5) * 0.11 : 0;
        const manualRockerRad = (k.suspensionTestDeg * Math.PI) / 180;
        const steerRad = (k.steeringTestDeg * Math.PI) / 180;

        rigRef.current.updateKinematics({
          wheelRotationRad: wheelAngle,
          rockerDifferentialRad: manualRockerRad + waveRad,
          bogiePitchRad: bogieWaveRad,
          steeringAngleRad: steerRad,
        });
      }

      const orb = orbitRef.current;
      const cx = orb.distance * Math.cos(orb.elevation) * Math.sin(orb.azimuth);
      const cy = 0.55 + orb.distance * Math.sin(orb.elevation);
      const cz = orb.distance * Math.cos(orb.elevation) * Math.cos(orb.azimuth);
      camera.position.set(cx, cy, cz);
      camera.lookAt(0, 0.48, 0);

      const cssW = canvas.clientWidth || 480;
      const cssH = canvas.clientHeight || 290;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderThreeObjectToCanvas2D(ctx, cssW, cssH, modelHolder, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
    };
  }, [modalOpen, activeRover, viewMode, studioTab]);

  if (!modalOpen) return null;

  const primaryPhoto = activeRover.officialPhotos[0];
  const beginnerGuide = getRoverBeginnerGuide(activeRover);
  const allFleetWithCustom = [...NASA_MOON_ROVERS, customBuiltRover];

  const updateCustomConfig = (patch: Partial<CustomRoverConfig>) => {
    const cb = onChangeCustomRoverConfig ?? onCustomRoverConfigChange;
    if (!cb) return;
    cb({
      ...customRoverConfig,
      ...patch,
    });
  };

  return (
    <div className="tt-modal-backdrop" onClick={onClose}>
      <div className="tt-modal-window" onClick={(e) => e.stopPropagation()}>
        {/* Clean Apple-Inspired Modal Header */}
        <div
          style={{
            padding: '16px 24px',
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <span className="tt-section-eyebrow" style={{ display: 'block', marginBottom: 2 }}>
              NASA Moon Rover Studio
            </span>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              {studioTab === 'fleet'
                ? 'Explore NASA Moon Rovers'
                : studioTab === 'custom'
                  ? 'Build Your Own Custom Moon Robot'
                  : 'Compare Rover Capabilities'}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tt-vp-pill-group">
              <button
                type="button"
                className={`tt-vp-pill-btn ${studioTab === 'fleet' ? 'active' : ''}`}
                onClick={() => {
                  setStudioTab('fleet');
                  if (inspectRoverId === 'custom') setInspectRoverId('perseverance');
                }}
              >
                NASA Fleet
              </button>
              <button
                type="button"
                className={`tt-vp-pill-btn ${studioTab === 'custom' ? 'active' : ''}`}
                onClick={() => {
                  setStudioTab('custom');
                  setInspectRoverId('custom');
                }}
              >
                ★ Custom Robot Builder
              </button>
              <button
                type="button"
                className={`tt-vp-pill-btn ${studioTab === 'compare' ? 'active' : ''}`}
                onClick={() => setStudioTab('compare')}
              >
                Compare All
              </button>
            </div>

            <button type="button" className="tt-btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        {/* Fleet Selector Strip */}
        {studioTab !== 'custom' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 10,
              padding: '12px 24px',
              background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            {allFleetWithCustom.map((rover) => {
              const isInspecting = rover.id === inspectRoverId;
              const isAssigned = rover.id === selectedRoverId;
              return (
                <div
                  key={rover.id}
                  onClick={() => {
                    if (rover.id === 'custom') {
                      setStudioTab('custom');
                      setInspectRoverId('custom');
                    } else {
                      setInspectRoverId(rover.id);
                      if (studioTab === 'compare') setStudioTab('fleet');
                    }
                  }}
                  className={`tt-card-interactive ${isInspecting ? 'selected' : ''}`}
                  style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 9 }}
                >
                  <img
                    src={rover.officialPhotos[0]?.url}
                    alt={rover.name}
                    style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover', background: '#17191D' }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong
                        style={{
                          fontSize: 12.5,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {rover.name}
                      </strong>
                      {isAssigned && (
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: 'var(--rec-green)',
                            flexShrink: 0,
                          }}
                          title="Active Mission Rover"
                        />
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {rover.wheels.count}W · {rover.mobilityProfile.operationalMaxSlopeDeg}° max
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 3: COMPARE ALL ROVERS */}
        {studioTab === 'compare' ? (
          <div style={{ padding: 24, overflowY: 'auto', flex: 1, background: 'var(--bg-app)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
              <div className="tt-card">
                <strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
                  Max Safe Hill Steepness
                </strong>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Steeper limit allows climbing crater rims and river delta slopes.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {allFleetWithCustom.map((r) => (
                    <div key={r.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                        <strong>{r.name}</strong>
                        <span className="tt-mono">{r.mobilityProfile.operationalMaxSlopeDeg}°</span>
                      </div>
                      <div className="tt-progress-track">
                        <div
                          className="tt-progress-fill"
                          style={{
                            width: `${Math.min(100, (r.mobilityProfile.operationalMaxSlopeDeg / 27) * 100)}%`,
                            background: r.id === 'custom' ? 'var(--moon-accent)' : 'var(--rec-green)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="tt-card">
                <strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
                  Max Rock Climb Height
                </strong>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Tallest boulder or rock step the suspension can safely roll over.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {allFleetWithCustom.map((r) => (
                    <div key={r.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                        <strong>{r.name}</strong>
                        <span className="tt-mono">{r.suspension.maxObstacleHeightCm} cm</span>
                      </div>
                      <div className="tt-progress-track">
                        <div
                          className="tt-progress-fill"
                          style={{
                            width: `${Math.min(100, (r.suspension.maxObstacleHeightCm / 60) * 100)}%`,
                            background: r.id === 'custom' ? 'var(--moon-accent)' : 'var(--sci-blue)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="tt-card">
                <strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
                  Wheel Count & Diameter
                </strong>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Larger wheels roll over uneven terrain with lower slip.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {allFleetWithCustom.map((r) => (
                    <div key={r.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                        <strong>
                          {r.name} ({r.wheels.count} wheels)
                        </strong>
                        <span className="tt-mono">Ø {r.wheels.diameterCm} cm</span>
                      </div>
                      <div className="tt-progress-track">
                        <div
                          className="tt-progress-fill"
                          style={{
                            width: `${Math.min(100, (r.wheels.diameterCm / 60) * 100)}%`,
                            background: 'var(--moon-accent)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {allFleetWithCustom.map((r) => (
                <div key={r.id} className="tt-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong style={{ fontSize: 16 }}>{r.name}</strong>
                      <span className={`tt-badge ${r.status === 'OPERATIONAL' ? 'green' : ''}`}>
                        {r.id === 'custom' ? 'Custom' : r.status === 'OPERATIONAL' ? 'Operational' : 'Historical'}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                      {getRoverBeginnerGuide(r).whatDesignedToDo}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={r.id === selectedRoverId ? 'tt-btn-primary' : 'tt-btn-secondary'}
                    style={{ width: '100%' }}
                    onClick={() => {
                      onSelectRover(r.id);
                      setInspectRoverId(r.id);
                    }}
                  >
                    {r.id === selectedRoverId ? `✓ Active Mission Robot` : `Use ${r.name}`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* TAB 1 (NASA FLEET) & TAB 2 (CUSTOM ROVER BUILDER): 2-COLUMN SPLIT WITH LIVE 3D PREVIEW */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '480px 1fr',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            {/* Left Column: Dark 3D Rover Viewport + Motion Controls + Official NASA Photo */}
            <div
              style={{
                borderRight: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--bg-elevated)',
                padding: 18,
                gap: 14,
                overflowY: 'auto',
              }}
              className="tt-rover-studio-left"
            >
              <div
                style={{
                  borderRadius: 16,
                  overflow: 'hidden',
                  flexShrink: 0,
                  background: '#090C10',
                  border: '1px solid var(--border-color)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div
                  style={{
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    color: '#F3F4F6',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <span>3D Interactive Model · {activeRover.name}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setViewMode('articulated_rig')}
                      style={{
                        padding: '3px 9px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        background: viewMode === 'articulated_rig' ? '#D8794F' : 'rgba(255,255,255,0.12)',
                        color: '#FFFFFF',
                      }}
                    >
                      Articulated Rig
                    </button>
                    {activeRover.model3d.glbUrl && (
                      <button
                        type="button"
                        onClick={() => setViewMode('nasa_glb')}
                        style={{
                          padding: '3px 9px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: 'none',
                          cursor: 'pointer',
                          background: viewMode === 'nasa_glb' ? '#397EBE' : 'rgba(255,255,255,0.12)',
                          color: '#FFFFFF',
                        }}
                      >
                        NASA 3D GLB
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ position: 'relative', height: 290, width: '100%' }}>
                  <canvas
                    ref={canvasRef}
                    width={480}
                    height={290}
                    style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
                    onMouseDown={(e) => {
                      orbitRef.current.dragging = true;
                      orbitRef.current.lastX = e.clientX;
                      orbitRef.current.lastY = e.clientY;
                    }}
                    onMouseMove={(e) => {
                      if (!orbitRef.current.dragging) return;
                      const dx = e.clientX - orbitRef.current.lastX;
                      const dy = e.clientY - orbitRef.current.lastY;
                      orbitRef.current.lastX = e.clientX;
                      orbitRef.current.lastY = e.clientY;
                      orbitRef.current.azimuth -= dx * 0.01;
                      orbitRef.current.elevation = Math.max(
                        0.08,
                        Math.min(1.25, orbitRef.current.elevation + dy * 0.008),
                      );
                    }}
                    onMouseUp={() => {
                      orbitRef.current.dragging = false;
                    }}
                    onMouseLeave={() => {
                      orbitRef.current.dragging = false;
                    }}
                    onWheel={(e) => {
                      e.preventDefault();
                      orbitRef.current.distance = Math.max(
                        2.1,
                        Math.min(6.5, orbitRef.current.distance + e.deltaY * 0.0025),
                      );
                    }}
                  />
                  {viewMode === 'nasa_glb' && glbStatus === 'loading' && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(9,12,16,0.75)',
                        color: '#FFFFFF',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      Loading NASA 3D GLB mesh…
                    </div>
                  )}
                </div>
              </div>

              {/* Clean Kinematic Test Controls */}
              {viewMode === 'articulated_rig' && (
                <div className="tt-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <strong style={{ fontSize: 13 }}>Test Wheels & Suspension</strong>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className={`tt-badge ${autoSpinDrive ? 'green' : ''}`}
                        style={{ cursor: 'pointer', border: '1px solid var(--border-color)' }}
                        onClick={() => setAutoSpinDrive(!autoSpinDrive)}
                      >
                        {autoSpinDrive ? '● Spin Wheels' : '○ Pause Wheels'}
                      </button>
                      <button
                        type="button"
                        className={`tt-badge ${animateSuspensionWave ? 'blue' : ''}`}
                        style={{ cursor: 'pointer', border: '1px solid var(--border-color)' }}
                        onClick={() => setAnimateSuspensionWave(!animateSuspensionWave)}
                      >
                        {animateSuspensionWave ? '● Rock Climb' : '○ Level'}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span>Suspension Tilt</span>
                        <span className="tt-mono">{suspensionTestDeg}°</span>
                      </div>
                      <input
                        type="range"
                        className="tt-slider"
                        min={-16}
                        max={16}
                        step={1}
                        value={suspensionTestDeg}
                        onChange={(e) => setSuspensionTestDeg(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span>Wheel Steering</span>
                        <span className="tt-mono">{steeringTestDeg}°</span>
                      </div>
                      <input
                        type="range"
                        className="tt-slider"
                        min={-35}
                        max={35}
                        step={1}
                        value={steeringTestDeg}
                        onChange={(e) => setSteeringTestDeg(Number(e.target.value))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Official NASA Photography */}
              {primaryPhoto && (
                <div className="tt-card" style={{ padding: 12 }}>
                  <img
                    src={primaryPhoto.url}
                    alt={primaryPhoto.title}
                    style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, marginBottom: 8 }}
                  />
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <strong>{primaryPhoto.title}</strong> · {primaryPhoto.credit}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Custom Rover Builder OR NASA Fleet Profile */}
            {studioTab === 'custom' ? (
              <div
                style={{
                  padding: 24,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  background: 'var(--bg-primary)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="tt-section-eyebrow">Step-by-Step Custom Robot Designer</div>
                    <h3 style={{ fontSize: 22, fontWeight: 700 }}>{customRoverConfig.name}</h3>
                  </div>
                  <button
                    type="button"
                    className="tt-btn-primary"
                    onClick={() => {
                      onSelectRover('custom');
                      if (onDeployRoverToLandingSite) {
                        onDeployRoverToLandingSite(customBuiltRover, customBuiltRover.landingCoords);
                      }
                      onClose();
                    }}
                  >
                    ✓ Use Custom Robot on Moon
                  </button>
                </div>

                {/* Live Mobility Summary Card */}
                <div className="tt-card-soft" style={{ borderLeft: '4px solid var(--rec-green)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rec-green)', marginBottom: 4 }}>
                    Live Mobility Impact on Route Planning
                  </div>
                  <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    Your custom design can safely climb hills up to{' '}
                    <strong>{customBuiltRover.mobilityProfile.operationalMaxSlopeDeg}°</strong>, roll over rocks up to{' '}
                    <strong>{customBuiltRover.suspension.maxObstacleHeightCm} cm</strong> tall, and weighs{' '}
                    <strong>{customBuiltRover.dimensions.massKg} kg</strong>.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {/* 1. Wheel Count */}
                  <div className="tt-card">
                    <div className="tt-section-eyebrow">1. Number of Wheels</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                      More wheels spread weight and improve climbing traction.
                    </div>
                    <div className="tt-vp-pill-group" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                      {([4, 6, 8] as const).map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          className={`tt-vp-pill-btn ${customRoverConfig.wheelCount === cnt ? 'active' : ''}`}
                          onClick={() => updateCustomConfig({ wheelCount: cnt })}
                        >
                          {cnt} Wheels
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 2. Wheel Diameter & Tread */}
                  <div className="tt-card">
                    <div className="tt-section-eyebrow">2. Wheel Size & Grip</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span>Wheel Diameter</span>
                      <strong className="tt-mono">{customRoverConfig.wheelDiameterCm} cm</strong>
                    </div>
                    <input
                      type="range"
                      className="tt-slider"
                      min={20}
                      max={60}
                      step={2}
                      value={customRoverConfig.wheelDiameterCm}
                      onChange={(e) => updateCustomConfig({ wheelDiameterCm: Number(e.target.value) })}
                      style={{ marginBottom: 10 }}
                    />
                    <div className="tt-vp-pill-group" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                      {(
                        [
                          { id: 'curved', label: 'Curved' },
                          { id: 'straight', label: 'Straight' },
                          { id: 'chevron', label: 'Chevron' },
                        ] as const
                      ).map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          className={`tt-vp-pill-btn ${customRoverConfig.grouserType === g.id ? 'active' : ''}`}
                          onClick={() => updateCustomConfig({ grouserType: g.id })}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3. Suspension Type */}
                  <div className="tt-card">
                    <div className="tt-section-eyebrow">3. Suspension System</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {(
                        [
                          { id: 'rocker_bogie', label: 'Rocker-Bogie Linkage (Best for Rocks)' },
                          { id: 'twin_bogie', label: 'Articulated Twin-Bogie' },
                          { id: 'independent_strut', label: 'Lightweight Independent Struts' },
                        ] as const
                      ).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => updateCustomConfig({ suspensionType: s.id })}
                          className={`tt-card-interactive ${customRoverConfig.suspensionType === s.id ? 'selected' : ''}`}
                          style={{ padding: '8px 12px', textAlign: 'left', fontSize: 13, fontWeight: 600 }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Name, Body Size & Power */}
                  <div className="tt-card">
                    <div className="tt-section-eyebrow">4. Name, Size & Power</div>
                    <input
                      type="text"
                      value={customRoverConfig.name}
                      onChange={(e) => updateCustomConfig({ name: e.target.value })}
                      placeholder="Custom Rover Name"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: '1px solid var(--border-color)',
                        fontSize: 13.5,
                        marginBottom: 8,
                      }}
                    />
                    <div className="tt-vp-pill-group" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 8 }}>
                      {(
                        [
                          { id: 'compact', label: 'Compact' },
                          { id: 'midsize', label: 'Midsize' },
                          { id: 'flagship', label: 'Flagship' },
                        ] as const
                      ).map((sz) => (
                        <button
                          key={sz.id}
                          type="button"
                          className={`tt-vp-pill-btn ${customRoverConfig.chassisSize === sz.id ? 'active' : ''}`}
                          onClick={() => updateCustomConfig({ chassisSize: sz.id })}
                        >
                          {sz.label}
                        </button>
                      ))}
                    </div>
                    <div className="tt-vp-pill-group" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                      <button
                        type="button"
                        className={`tt-vp-pill-btn ${customRoverConfig.powerSource === 'mmrtg' ? 'active' : ''}`}
                        onClick={() => updateCustomConfig({ powerSource: 'mmrtg' })}
                      >
                        MMRTG Nuclear
                      </button>
                      <button
                        type="button"
                        className={`tt-vp-pill-btn ${customRoverConfig.powerSource === 'solar' ? 'active' : ''}`}
                        onClick={() => updateCustomConfig({ powerSource: 'solar' })}
                      >
                        Solar Panels
                      </button>
                    </div>
                  </div>
                </div>

                {/* 5. Scientific Instruments */}
                <div className="tt-card">
                  <div className="tt-section-eyebrow">5. Scientific Instruments</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 8 }}>
                    {CUSTOM_INSTRUMENT_CATALOG.map((inst) => {
                      const checked = customRoverConfig.instrumentIds.includes(inst.id);
                      return (
                        <div
                          key={inst.id}
                          onClick={() => {
                            const next = checked
                              ? customRoverConfig.instrumentIds.filter((i) => i !== inst.id)
                              : [...customRoverConfig.instrumentIds, inst.id];
                            updateCustomConfig({
                              instrumentIds: next.length > 0 ? next : [inst.id],
                            });
                          }}
                          className={`tt-card-interactive ${checked ? 'selected' : ''}`}
                          style={{ padding: '10px 12px' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                            <span>{checked ? '✓ ' : '+ '}{inst.name}</span>
                            <span className="tt-mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                              {inst.massKg} kg
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {inst.beginnerDesc}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* TAB 1: NASA ROVER FLEET PROFILE */
              <div
                style={{
                  padding: 24,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 18,
                  background: 'var(--bg-primary)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h3 style={{ fontSize: 24, fontWeight: 800 }}>
                        {activeRover.name}
                      </h3>
                      <span className={`tt-badge ${activeRover.status === 'OPERATIONAL' ? 'green' : ''}`}>
                        {activeRover.statusBadgeText}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {activeRover.missionName} · Landed {activeRover.landingDate} at{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>{activeRover.landingSiteName}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="tt-btn-primary"
                    onClick={() => {
                      onSelectRover(activeRover.id);
                      onClose();
                    }}
                  >
                    {activeRover.id === selectedRoverId
                      ? `✓ ${activeRover.name} Active`
                      : `Select ${activeRover.name} for Mission`}
                  </button>
                </div>

                {/* Plain-Language Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div className="tt-card-soft">
                    <div className="tt-section-eyebrow">Mission Purpose</div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.55 }}>
                      {beginnerGuide.whatDesignedToDo}
                    </p>
                  </div>
                  <div className="tt-card-soft">
                    <div className="tt-section-eyebrow">Wheels & Mobility</div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.55 }}>
                      {beginnerGuide.howManyWheelsAndWhy} {beginnerGuide.howItMovesOverRocks}
                    </p>
                  </div>
                  <div className="tt-card-soft">
                    <div className="tt-section-eyebrow">Scientific Instruments</div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.55 }}>
                      {beginnerGuide.whatScienceItPerforms}
                    </p>
                  </div>
                  <div className="tt-card-soft">
                    <div className="tt-section-eyebrow">What Makes It Special</div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.55 }}>
                      {beginnerGuide.whatMakesItDifferent}
                    </p>
                  </div>
                </div>

                <RockerBogieDiagramCard rover={activeRover} />

                {mode === 'advanced' && (
                  <div className="tt-card">
                    <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
                      Engineering & Pathfinding Telemetry
                    </strong>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                      {activeRover.mobilityProfile.mobilitySummary}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      <div className="tt-card-soft" style={{ padding: 10 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Wheel Dimensions</div>
                        <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700 }}>
                          {activeRover.wheels.diameterCm} × {activeRover.wheels.widthCm} cm ({activeRover.wheels.skinThicknessMm} mm)
                        </div>
                      </div>
                      <div className="tt-card-soft" style={{ padding: 10 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>L × W × H / Mass</div>
                        <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700 }}>
                          {activeRover.dimensions.lengthM}×{activeRover.dimensions.widthM}×{activeRover.dimensions.heightM} m · {activeRover.dimensions.massKg} kg
                        </div>
                      </div>
                      <div className="tt-card-soft" style={{ padding: 10 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>A* Penalties</div>
                        <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700 }}>
                          {activeRover.mobilityProfile.slopePenaltyFactor}× slope · {activeRover.mobilityProfile.roughnessPenaltyFactor}× TRI
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
