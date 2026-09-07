declare module '*.wasm?url' { const url: string; export default url; }
declare module '*?worker' { const WorkerConstructor: { new (): Worker }; export default WorkerConstructor; }
