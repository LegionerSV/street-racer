'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowUpRight, Flag, MapPin, Route, Pause, Volume2 } from 'lucide-react';
import {TouchControls} from '@/game/TouchControls';
import type {DrivingKey} from '@/game/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { validateCenter } from '@/game/data';
import {RegionStream} from '@/game/region-stream';
import {LoadingLog,readLoadingLog,downloadLoadingLog} from '@/game/loading-log';
import { WorldWorker } from '@/game/worker-client';
import type { Game } from '@/game/runtime';
import type { HUD, World, Settings } from '@/game/types';
import { Minimap } from '@/game/Minimap';
import { defaultSettings, readSettings, saveSettings, recordKey, saveRecord } from '@/game/storage';
import { formatTime } from '@/game/simulation';
const INITIAL_CENTER = { lat: 59.934, lon: 30.335 };

export default function Home() {
  const mapEl = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(INITIAL_CENTER);
  const [coords, setCoords] = useState(`${INITIAL_CENTER.lat}, ${INITIAL_CENTER.lon}`);
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<'select' | 'loading' | 'playing'>('select');
  const [progress, setProgress] = useState({ text: '', percent: 0 });
  const [hasLoadingLog,setHasLoadingLog]=useState(false);
  const [loadingSeconds,setLoadingSeconds]=useState(0);
  const loadingLogRef=useRef<LoadingLog|null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [hud, setHUD] = useState<HUD | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [record, setRecord] = useState<{ best: number; improved: boolean } | null>(null);
  const [licenses, setLicenses] = useState(false);
  const [debug, setDebug] = useState(false);
  const [touchDevice,setTouchDevice]=useState(false);
  const touchVisible=settings.touchControls==='on'||settings.touchControls!=='off'&&touchDevice;
  const [diagnostics, setDiagnostics] = useState<ReturnType<Game['diagnostics']> | null>(null);
  const savedRace = useRef<string | null>(null);
  const gameRef = useRef<Game | null>(null);
  const workerRef = useRef<WorldWorker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const attemptRef = useRef(0);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  /* oxlint-disable react/react-compiler, react-hooks/exhaustive-deps -- Гидратация браузерных настроек; cleanup закрывает именно текущие игровые ресурсы. */
  useEffect(() => {
    const media=window.matchMedia('(pointer: coarse)'),changed=()=>setTouchDevice(media.matches);
    setTouchDevice(media.matches);setSettings(readSettings(media.matches));setDebug(new URLSearchParams(location.search).has('debug'));setHasLoadingLog(!!readLoadingLog());media.addEventListener('change',changed);
    return () => { media.removeEventListener('change',changed);attemptRef.current++; loadingLogRef.current?.finish('cancelled');abortRef.current?.abort(); gameRef.current?.dispose(); workerRef.current?.dispose(); };
  }, []);
  /* oxlint-enable react/react-compiler, react-hooks/exhaustive-deps */
  useEffect(()=>{if(stage!=='loading')return;const started=performance.now(),timer=setInterval(()=>setLoadingSeconds(Math.floor((performance.now()-started)/1000)),1000);return()=>clearInterval(timer);},[stage]);
  function downloadLog(){const report=loadingLogRef.current?.snapshot()??readLoadingLog();if(report)downloadLoadingLog(report);}
  const touchInput=useCallback((pointerId:number,key:DrivingKey,down:boolean)=>gameRef.current?.setTouchControl(pointerId,key,down),[]);
  useEffect(() => {
    let dead = false;
    import('leaflet').then(L => {
      if (dead || !mapEl.current) return;
      const map = L.map(mapEl.current, { zoomControl: false }).setView([INITIAL_CENTER.lat, INITIAL_CENTER.lon], 13);
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      const rectangle = L.rectangle([[0, 0], [0, 0]], { color: '#d8ff3e', weight: 2, fillOpacity: .08 }).addTo(map);
      const marker = L.circleMarker([INITIAL_CENTER.lat, INITIAL_CENTER.lon], { radius: 7, color: '#d8ff3e', fillOpacity: 1 }).addTo(map);
      const update = (lat: number, lon: number) => {
        const dy = 1000 / 111320, dx = dy / Math.cos(lat * Math.PI / 180);
        rectangle.setBounds([[lat - dy, lon - dx], [lat + dy, lon + dx]]);
        marker.setLatLng([lat, lon]); setCenter({ lat, lon }); setCoords(`${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      };
      update(INITIAL_CENTER.lat, INITIAL_CENTER.lon);
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => update(e.latlng.lat, e.latlng.lng));
      map.on('locationselect', e => { const selected = e as import('leaflet').LeafletEvent & { lat: number; lon: number }; update(selected.lat, selected.lon); map.setView([selected.lat, selected.lon], 13); });
    }).catch(() => setMessage('Не удалось открыть карту. Перезагрузите страницу.'));
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);
  function locate() {
    const [lat, lon] = coords.trim().split(/[,;\s]+/).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 83.9 || Math.abs(lon) > 179.9) {
      setMessage(`Введите широту и долготу, например: ${INITIAL_CENTER.lat}, ${INITIAL_CENTER.lon}.`); return;
    }
    setMessage(''); mapRef.current?.fire('locationselect', { lat, lon });
  }
  async function start() {
    if (abortRef.current) return;
    const attempt = ++attemptRef.current;
    const abort = new AbortController(); abortRef.current = abort;
    const log=new LoadingLog(center,settings.quality);loadingLogRef.current=log;setHasLoadingLog(true);setLoadingSeconds(0);
    setMessage(''); setRecord(null); setStage('loading'); setProgress({ text: 'Открываем район', percent: 1 });
    const update = (text: string, percent: number) => { if (attempt === attemptRef.current) setProgress({ text, percent }); };
    const mapStream=new RegionStream(center,settings.quality,log);
    try {
      validateCenter(center);
      const [region,{Game}]=await Promise.all([log.measure('Данные района',()=>mapStream.start(abort.signal,update)),log.measure('Загрузка игрового движка',()=>import('@/game/runtime'))]);abort.signal.throwIfAborted();
      const worker = new WorldWorker(); workerRef.current = worker;
      update('Соединяем дороги и строим маршруты', 84);
      const generated = await log.measure('Построение мира в worker',()=>worker.build(region),{elements:region.elements.length}); abort.signal.throwIfAborted();
      if (generated.spawnEdge < 0) throw new Error('В стартовом районе нет доступных дорог. Выберите другой участок.');
      setWorld(generated);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const game = await Game.create(canvasRef.current!, generated, worker, settings, next => {
        setHUD(next); if (new URLSearchParams(location.search).has('debug')) setDiagnostics(gameRef.current?.diagnostics() || null);
        if (next.race?.phase !== 'finished') savedRace.current = null;
        else if (next.race.finishTime !== undefined) {
          const key = recordKey(center, next.race.route.id);
          if (savedRace.current !== key) { savedRace.current = key; setRecord(saveRecord(key, next.race.finishTime)); }
        }
      }, update, abort.signal,log);
      if (attempt !== attemptRef.current) { mapStream.dispose();game.dispose(); return; }
      gameRef.current = game; log.finish('success');setStage('playing');
      game.attachMapStream(mapStream,next=>{if(attempt===attemptRef.current)setWorld(next);});
    } catch (error) {
      mapStream.dispose();
      const cancelled=abort.signal.aborted;
      log.finish(cancelled?'cancelled':'error',error instanceof Error?error.message:String(error));abort.abort();
      if (attempt !== attemptRef.current) return;
      workerRef.current?.dispose(); workerRef.current = null;
      if (!cancelled) setMessage(error instanceof Error ? error.message : 'Не удалось подготовить район. Попробуйте ещё раз.');
      setStage('select');
    } finally { if (attempt === attemptRef.current) abortRef.current = null; }
  }
  function cancel() { attemptRef.current++; loadingLogRef.current?.finish('cancelled');abortRef.current?.abort(); abortRef.current = null; workerRef.current?.dispose(); workerRef.current = null; gameRef.current?.dispose(); gameRef.current = null; setStage('select'); setHUD(null); setWorld(null); setTimeout(() => mapRef.current?.invalidateSize(), 0); }
  function changeSettings(next: Settings) { setSettings(next); saveSettings(next); gameRef.current?.setSettings(next); }
  const startRef = useRef(start);
  const stateRef = useRef({ stage, center });
  useEffect(() => { startRef.current = start; stateRef.current = { stage, center }; });
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* WebMCP необязателен для браузера игрока. */ } };
    register({ name: 'select_driving_region', title: 'Выбрать район', description: 'Выбрать стартовый участок 2 × 2 км с последующей подгрузкой по ходу движения.', inputSchema: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async (input: unknown) => { const value = input as { lat: number; lon: number }; validateCenter(value); if (stateRef.current.stage !== 'select') throw new Error('Сначала вернитесь к выбору района.'); mapRef.current?.fire('locationselect', value); await new Promise(resolve => requestAnimationFrame(resolve)); return { center: value, sizeKm: 2 }; } });
    register({ name: 'read_driving_status', title: 'Состояние игры', description: 'Прочитать выбранный район, режим и состояние загрузки игры.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ ...stateRef.current, game: gameRef.current?.diagnostics() || null }) });
    return () => lifecycle.abort();
  }, []);
  // Диагностика локального прототипа доступна только с явным параметром URL.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    const debug = { get game() { return gameRef.current; }, get state() { return stateRef.current; }, get loadingLog(){return loadingLogRef.current?.snapshot()??readLoadingLog();},start: () => startRef.current(), select: (lat: number, lon: number) => mapRef.current?.fire('locationselect', { lat, lon }) };
    (window as unknown as { streetRacer: typeof debug }).streetRacer = debug;
    return () => { delete (window as unknown as { streetRacer?: unknown }).streetRacer; };
  }, []);
  return <>
  <main className="select-screen" style={{ display: stage === 'playing' ? 'none' : undefined }}>
    <div ref={mapEl} className="world-map" />
    <div className="map-vignette" />
    {/* oxlint-disable-next-line next/no-html-link-for-pages -- Общий экран локальной SSR-версии и статической сборки без Next router. */}
    <header className="masthead"><a className="wordmark" href="./">STREET<span>RACER</span><i>06 / LOCAL</i></a><div className="status-dot">СВОЙ ГОРОД. СВОЙ МАРШРУТ.</div></header>
    <section className="selection-panel">
      <div className="eyebrow"><span /> СВОБОДНАЯ ЕЗДА + ГОНКИ</div>
      <h1>Знакомые улицы.<br /><em>Другой темп.</em></h1>
      <p className="intro">Выбери точку на карте. Вокруг неё появится твой район для заездов.</p>
      <div className="region-summary"><MapPin size={20} /><div><b>ТВОЯ ТЕРРИТОРИЯ</b><span>{Math.abs(center.lat).toFixed(4)}° {center.lat < 0 ? 'S' : 'N'} · {Math.abs(center.lon).toFixed(4)}° {center.lon < 0 ? 'W' : 'E'}</span></div><strong>2 × 2<small>КМ · СТАРТ</small></strong></div>
      <label className="field-label" htmlFor="coords">Координаты центра</label>
      <div className="coordinate-field"><input id="coords" value={coords} onChange={e => setCoords(e.target.value)} onKeyDown={e => e.key === 'Enter' && locate()} /><button onClick={locate} aria-label="Перейти к координатам"><ArrowUpRight size={22} /></button></div>
      <Button className="drive-button" disabled={stage === 'loading'} onClick={start}><span>ВЫЕХАТЬ НА УЛИЦЫ</span><ArrowUpRight size={23} /></Button>
      {message && <output className="message">{message}</output>}
      {hasLoadingLog&&<Button variant="outline" onClick={downloadLog}>Скачать лог загрузки</Button>}
      <div className="mode-pills"><span><Route size={15} /> Открытый мир</span><span><Flag size={15} /> 3 соперника</span></div>
    </section>
    <div className="map-hint"><span className="crosshair-symbol">+</span> Нажми на карту, чтобы выбрать район</div>
    <footer className={`selection-footer ${touchVisible?'touch-intro':''}`}><span>WASD <i>движение</i></span><span>ПРОБЕЛ <i>ручник</i></span><span>R <i>на дорогу</i></span><span>ESC <i>пауза</i></span><span>SHIFT <i>нитро</i></span>{touchVisible&&<strong>Сенсорные кнопки появятся в игре</strong>}<button onClick={() => setLicenses(true)}>Источники данных</button></footer>
  </main>
  <canvas ref={canvasRef} tabIndex={0} className={`game-canvas ${stage === 'playing' ? 'visible' : ''}`} aria-label="Трёхмерная игра. Управление: WASD, пробел — ручник, R — восстановление, Shift — нитро, Esc — пауза. На телефоне доступны сенсорные кнопки." />
  {stage === 'loading' && <div className="loading-overlay"><section className="loading-card"><div className="eyebrow"><span /> ПОДГОТОВКА РАЙОНА</div><h2>Твои улицы<br /><em>становятся ближе.</em></h2><div className="loading-line"><output>{progress.text}</output><b>{Math.round(progress.percent)}%</b></div><Progress value={progress.percent} aria-label={progress.text} /><p>Стартовые 4 км² · дальше карта подгружается по ходу движения<br />Прошло {loadingSeconds} с</p><div className="loading-actions"><Button variant="outline" onClick={cancel}>Отменить загрузку</Button><Button variant="outline" onClick={downloadLog}>Скачать лог загрузки</Button></div></section></div>}
  {stage === 'playing' && hud && world && <div className={`game-hud ${touchVisible?'touch-layout':''} ${hud.boosting?'nitro-active':''}`}>
    {debug && <div className="debug-panel"><button onClick={() => gameRef.current?.startDriveTest()}>Автопроезд 90 с / стоп</button><button onClick={() => gameRef.current?.visitStructure('bridge')}>Проверить мост</button><button onClick={() => gameRef.current?.visitStructure('tunnel')}>Проверить тоннель</button><button onClick={() => gameRef.current?.resetPerformance()}>Сбросить замеры</button><button onClick={() => gameRef.current?.exportPerformance()}>Скачать замеры</button><pre>{JSON.stringify(diagnostics, null, 2)}</pre></div>}
    <header className="hud-header"><div><div className="eyebrow">STREET RACER / {hud.race ? 'ЗАЕЗД' : 'СВОБОДНАЯ ЕЗДА'}</div><h2>{hud.race?.route.title || hud.street || 'Твой город. Твои правила.'}</h2>{hud.lanes && <small className="lane-status">{hud.lanes}</small>}</div><div className="hud-actions"><span className="weather-status">{String(Math.floor(hud.hour || 0)).padStart(2,'0')}:{String(Math.floor((hud.hour || 0)%1*60)).padStart(2,'0')} · {hud.weather}{(hud.wetness || 0) > .2 && <small> МОКРАЯ ДОРОГА</small>}</span><span>{hud.fps} <small>FPS</small></span><Button variant="outline" size="icon" onClick={() => gameRef.current?.togglePause()} aria-label="Пауза и настройки"><Pause size={18} /></Button></div></header>
    {hud.race && <div className="race-stats"><div><small>ПОЗИЦИЯ</small><b>{hud.race.position}<i>/ 4</i></b></div><div><small>{hud.race.route.kind === 'circuit' ? 'КРУГ' : 'ПРОГРЕСС'}</small><b>{hud.race.route.kind === 'circuit' ? `${hud.race.lap} / 3` : `${Math.round(hud.race.checkpoint / hud.race.route.points.length * 100)}%`}</b></div><div><small>ВРЕМЯ</small><b>{formatTime(hud.race.elapsed)}</b></div></div>}
    {hud.race?.phase === 'countdown' && <div className="countdown">{Math.max(1, Math.ceil(hud.race.countdown))}<span>ПРИГОТОВЬСЯ</span></div>}
    {hud.loading && <output className="streaming-banner">{hud.mapStatus || "Подготавливаем улицы впереди…"}</output>}
    {hud.nearRace && !hud.race && <button className="race-invite" onClick={() => gameRef.current?.startRace(hud.nearRace!)}><span className="keycap">E</span><div><small>{hud.nearRace.kind === 'circuit' ? 'КОЛЬЦЕВОЙ ЗАЕЗД · 3 КРУГА' : 'СПРИНТ · 3 СОПЕРНИКА'}</small><b>{hud.nearRace.title}</b><span>{(hud.nearRace.length / 1000).toFixed(1)} км · начать заезд</span></div><Flag size={25} /></button>}
    <div className="minimap-panel"><Minimap world={world} hud={hud} mobile={settings.quality==='mobile'} /><div className="minimap-caption"><span>{hud.mapStatus || "КАРТА ПО ХОДУ ДВИЖЕНИЯ"}</span><span>{world.drivingSide === 'left' ? 'ЛЕВОСТОРОННЕЕ' : 'ПРАВОСТОРОННЕЕ'}</span></div></div>
    <div className="speedometer"><div className="speed-top"><span>ПЕРЕДАЧА <b>{hud.gear}</b></span><span>{(hud.odometer! / 1000 || 0).toFixed(2)} КМ</span></div><div className="speed-number">{Math.round(hud.speed).toString().padStart(3, '0')}<small>КМ/Ч</small></div><div className="rpm"><i style={{ width: `${Math.min(100, hud.speed % 36 / 36 * 75 + 25)}%` }} /></div>{Math.abs(hud.slip || 0) > .22 && hud.speed > 25 && <span className="drift-label">ЗАНОС</span>}<div className="nitro-meter"><meter className="sr-only" aria-label="Заряд нитро" min={0} max={100} value={Math.round((hud.nitro??1)*100)}/><div><b>{hud.boosting?'УСКОРЕНИЕ':'НИТРО'}</b><span>{Math.round((hud.nitro??1)*100)}%{touchVisible?'':' · SHIFT'}</span></div><i style={{width:`${(hud.nitro??1)*100}%`}}/></div><div className="speed-help">ПРОБЕЛ <span>ручник</span>　 R <span>на дорогу</span></div></div>
    {touchVisible&&!hud.paused&&!hud.loading&&hud.race?.phase!=='countdown'&&hud.race?.phase!=='finished'&&<TouchControls onInput={touchInput} onRecover={()=>gameRef.current?.recover()} nitro={hud.nitro??1}/>}
    <div className="game-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><button onClick={() => { if (!gameRef.current?.paused) gameRef.current?.togglePause(); setLicenses(true); }}>Данные и лицензии</button></div>
    {hud.race?.phase === 'finished' && <div className="finish-panel"><div className="eyebrow">ЗАЕЗД ЗАВЕРШЁН</div><h2>{hud.race.position === 1 ? 'Первое место.' : `${hud.race.position}-е место.`}</h2><strong>{formatTime(hud.race.finishTime || hud.race.elapsed)}</strong>{record && <p>{record.improved ? 'Новый личный рекорд' : `Лучшее время: ${formatTime(record.best)}`}</p>}<Button className="drive-button" onClick={() => gameRef.current?.finishRace()}>ВЕРНУТЬСЯ НА УЛИЦЫ <ArrowUpRight size={20} /></Button></div>}
  </div>}
  <Dialog open={stage === 'playing' && !!hud?.paused && !licenses} onOpenChange={open => { if (!open && gameRef.current?.paused) gameRef.current.togglePause(); }}><DialogContent className="pause-menu" showCloseButton={false}><DialogTitle>Небольшая остановка.</DialogTitle><DialogDescription>Район ждёт. Продолжи поездку или настрой игру.</DialogDescription>
    <Button variant="outline" onClick={downloadLog}>Скачать лог загрузки</Button>
    <Button variant="outline" onClick={() => gameRef.current?.exportPerformance()}>Скачать диагностику карты</Button>
    {hud?.message && <p className="message">{hud.message}<button onClick={() => gameRef.current?.retryStreaming()}>Повторить подготовку</button></p>}
    <fieldset><legend>Качество изображения</legend><RadioGroup value={settings.quality} onValueChange={v => changeSettings({ ...settings, quality: v as Settings['quality'] })} className="quality-options">{[['mobile','Для телефона'], ['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']].map(([value, label]) => <label key={value}><RadioGroupItem value={value} />{label}</label>)}</RadioGroup></fieldset>
    <fieldset><legend>Сенсорные кнопки</legend><RadioGroup value={settings.touchControls||'auto'} onValueChange={v=>changeSettings({...settings,touchControls:v as Settings['touchControls']})} className="quality-options">{[['auto','Автоматически'],['on','Включены'],['off','Выключены']].map(([value,label])=><label key={value}><RadioGroupItem value={value}/>{label}</label>)}</RadioGroup></fieldset>
    <fieldset><legend>Плотность трафика</legend><RadioGroup value={settings.traffic || 'city'} onValueChange={v => changeSettings({ ...settings, traffic: v as Settings['traffic'] })} className="quality-options">{[['light', 'Свободно'], ['city', 'Город'], ['rush', 'Час пик']].map(([value, label]) => <label key={value}><RadioGroupItem value={value} />{label}</label>)}</RadioGroup><p className="world-details">Машины появляются на дорогах рядом с тобой. Плотность зависит от района.{settings.quality==='mobile'&&' В режиме для телефона — до 48 машин рядом.'}</p></fieldset>
    <fieldset><legend>Погода</legend><RadioGroup value={settings.weather || 'dynamic'} onValueChange={v => changeSettings({ ...settings, weather: v as Settings['weather'] })} className="quality-options">{[['dynamic','Меняется'],['clear','Ясно'],['overcast','Облачно'],['rain','Дождь']].map(([value,label])=><label key={value}><RadioGroupItem value={value}/>{label}</label>)}</RadioGroup></fieldset>
    <div className="volume-setting"><label id="time-label">Начало цикла суток <span>{String(settings.hour ?? 17).padStart(2,'0')}:00</span></label><Slider aria-labelledby="time-label" value={[settings.hour ?? 17]} onValueChange={v=>changeSettings({...settings,hour:Array.isArray(v)?v[0]:v})} min={0} max={23} step={1}/><p className="world-details">Полные сутки проходят за 20 минут. Во время паузы время стоит.</p></div>
    <div className="volume-setting"><label id="volume-label"><Volume2 size={18} /> Громкость <span>{Math.round(settings.volume * 100)}%</span></label><Slider aria-labelledby="volume-label" value={[settings.volume * 100]} onValueChange={v => changeSettings({ ...settings, volume: (Array.isArray(v) ? v[0] : v) / 100 })} min={0} max={100} /></div>
    <div className="control-grid"><span>WASD / стрелки</span><b>Движение</b><span>Пробел</span><b>Ручник и занос</b><span>Shift / Нитро</span><b>Ускорение · заряд восстанавливается сам</b><span>R</span><b>Вернуться на дорогу</b><span>E</span><b>Начать заезд у маркера</b></div>
    <Button className="drive-button" onClick={() => gameRef.current?.togglePause()}>ПРОДОЛЖИТЬ ПОЕЗДКУ <ArrowUpRight size={20} /></Button>
    <Button variant="outline" onClick={()=>{gameRef.current?.recover();gameRef.current?.togglePause();}}>Вернуться на дорогу</Button>
    <Button variant="outline" onClick={cancel}>Выбрать другой район</Button>
    {world && <p className="world-details">{world.buildings.length.toLocaleString('ru')} зданий · {world.routes.length} маршрута гонок{world.warnings.length ? ` · ${world.warnings.length} замечаний к данным` : ''}</p>}
  </DialogContent></Dialog>
  <Dialog open={licenses} onOpenChange={setLicenses}><DialogContent className="pause-menu"><DialogTitle>Источники данных</DialogTitle><DialogDescription>Геометрия окружения создаётся по открытым данным. Фасады, недостающие высоты сооружений и циклы светофоров приблизительные.</DialogDescription><p>Дороги и объекты: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors, ODbL</a>. Загрузка через Overpass API.</p><p>Рельеф: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Mapzen Terrain Tiles</a>. Источники включают SRTM, GMTED, ETOPO1 и региональные наборы; <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">полные условия и авторство</a>.</p><p>Модели автомобилей и процедурное оформление созданы для этой игры. Звук двигателя синтезируется в браузере.</p></DialogContent></Dialog>
  </>;
}
