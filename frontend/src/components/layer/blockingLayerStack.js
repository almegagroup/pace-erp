const layerStack = [];

let nextLayerId = 1;

export function openBlockingLayer() {
  const layerId = `blocking-layer-${nextLayerId++}`;
  layerStack.push(layerId);
  return layerId;
}

export function closeBlockingLayer(layerId) {
  const index = layerStack.lastIndexOf(layerId);
  if (index === -1) return;

  layerStack.splice(index, 1);
}

export function isBlockingLayerActive() {
  return layerStack.length > 0;
}

export function isTopBlockingLayer(layerId) {
  return layerStack[layerStack.length - 1] === layerId;
}

export function getBlockingLayerIndex(layerId) {
  return layerStack.indexOf(layerId);
}
