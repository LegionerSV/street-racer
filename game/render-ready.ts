// Первый игровой кадр показываем после готовности материалов и текстур.
// Иначе интерфейс уже доступен, а вместо улицы несколько секунд видно небо.
export async function renderFirstFrame(
  ready: () => Promise<unknown>,
  draw: () => void,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  draw();
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    ready()
      .then(() => resolve(), reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
  draw();
}
