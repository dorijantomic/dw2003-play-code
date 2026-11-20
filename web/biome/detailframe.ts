// Framing for the gallery detail view: where to put a perspective camera so a bounding sphere fills the view, centred, nothing cut off.
// Pure maths (no three.js import) so tests/gallery-detail-frame.test.js can run it in node.
/** centre [x,y,z], radius, vertical fov in degrees, aspect (w/h), direction from the centre to the camera (any length). Returns camera position + zoom limits + near plane. */
export function frameSphere(center, radius, fovDeg, aspect, dir = [0.25, 0.3, 1]) {
  const r = Math.max(radius, 1e-3), vHalf = (fovDeg * Math.PI) / 360, hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const dist = (r / Math.sin(Math.min(vHalf, hHalf))) * 1.08;   // the narrower field decides; 8% margin
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return { position: [center[0] + (dir[0] / l) * dist, center[1] + (dir[1] / l) * dist, center[2] + (dir[2] / l) * dist], dist, near: Math.max(0.002, r * 0.01), minDistance: r * 0.05, maxDistance: r * 30 };
}
