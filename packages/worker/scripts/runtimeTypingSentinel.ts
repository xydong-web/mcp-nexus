// Keeps Node-runtime typing scope explicit for worker-side Node scripts.
export function getNodeRuntimeFingerprint(): string {
  return `${process.platform}-${process.version}`;
}
