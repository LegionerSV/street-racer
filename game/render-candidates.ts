import { Mesh, type AbstractMesh, type Scene } from '@babylonjs/core';

export function skipHiddenRenderCandidates(scene: Scene) {
  const original = scene.getActiveMeshCandidates;
  const candidates = { data: [] as AbstractMesh[], length: 0 };
  const filtered = () => {
    const source = original.call(scene);
    let count = 0;
    for (let i = 0; i < source.length; i++) {
      const mesh = source.data[i];
      // Невидимый источник instances всё равно подготавливает их отрисовку.
      if (
        mesh.isVisible ||
        mesh.actionManager ||
        (mesh instanceof Mesh &&
          (mesh.instances.length || mesh.hasThinInstances))
      )
        candidates.data[count++] = mesh;
    }
    candidates.data.length = candidates.length = count;
    return candidates;
  };
  scene.getActiveMeshCandidates = filtered;
  const restore = () => {
    if (scene.getActiveMeshCandidates === filtered)
      scene.getActiveMeshCandidates = original;
    candidates.data.length = candidates.length = 0;
  };
  scene.onDisposeObservable.addOnce(restore);
  return restore;
}
