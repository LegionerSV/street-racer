import { afterEach, expect, it, vi } from 'vitest';
import { LoadingLog, readLoadingLog, LOADING_LOG_KEY } from './loading-log';
afterEach(() => vi.unstubAllGlobals());
it('сохраняет этап, HTTP-ошибку и длительность даже после неудачной загрузки', async () => {
  // Arrange
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k),
    setItem: (k: string, v: string) => values.set(k, v),
  });
  const log = new LoadingLog({ lat: 59.934, lon: 30.335 }, 'mobile'),
    end = log.start('Карта', { endpoint: 'https://example.org', attempt: 1 });
  // Act
  end('error', { httpStatus: 504, error: 'Сервер карт ответил 504.' });
  log.finish('error', 'Сервер карт ответил 504.');
  const restored = readLoadingLog();
  // Assert
  expect(restored?.status).toBe('error');
  expect(restored?.error).toBe('Сервер карт ответил 504.');
  expect(restored?.entries[0]).toMatchObject({
    stage: 'Карта',
    status: 'error',
    details: { httpStatus: 504, attempt: 1 },
  });
  expect(restored!.entries[0].durationMs).toBeGreaterThanOrEqual(0);
  expect(values.has(LOADING_LOG_KEY)).toBe(true);
});
it('не теряет выполнявшийся запрос при перезагрузке и не падает без хранилища', () => {
  // Arrange
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k),
    setItem: (k: string, v: string) => values.set(k, v),
  });
  const log = new LoadingLog({ lat: 0, lon: 0 }, 'high');
  log.start('Карта / 1');
  // Act / Assert
  expect(readLoadingLog()).toMatchObject({
    status: 'interrupted',
    entries: [{ stage: 'Карта / 1', status: 'running' }],
  });
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw Error('Storage disabled');
    },
    setItem: () => {
      throw Error('Storage disabled');
    },
  });
  expect(() => log.finish('cancelled')).not.toThrow();
  expect(readLoadingLog()).toBeNull();
});
it('позднее завершение отменённого запроса не перезаписывает лог следующей попытки', () => {
  // Arrange
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k),
    setItem: (k: string, v: string) => values.set(k, v),
  });
  const old = new LoadingLog({ lat: 0, lon: 0 }, 'high'),
    end = old.start('Старая загрузка');
  old.finish('cancelled');
  const next = new LoadingLog({ lat: 1, lon: 2 }, 'mobile');
  next.start('Новая загрузка');
  // Act
  end('error', { error: 'Отмена' });
  old.finish('error');
  // Assert
  expect(readLoadingLog()?.center).toEqual({ lat: 1, lon: 2 });
});
