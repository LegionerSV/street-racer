import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

const projectRoot=fileURLToPath(new URL('.',import.meta.url));
const base=process.env.PAGES_BASE_PATH||'/street-racer/';
if(!base.startsWith('/')||!base.endsWith('/')||base.startsWith('//')){
  throw new Error('PAGES_BASE_PATH должен начинаться и заканчиваться символом /, например /street-racer/.');
}

// Отдельный выход не затрагивает локальную сборку Vinext в dist.
export default defineConfig({
  root:resolve(projectRoot,'static'),
  publicDir:resolve(projectRoot,'public'),
  base,
  resolve:{alias:{'@':projectRoot}},
  plugins:[react(),{name:'pages-nojekyll',generateBundle(){this.emitFile({type:'asset',fileName:'.nojekyll',source:''});}}],
  css:{postcss:{plugins:[tailwindcss({base:projectRoot})]}},
  worker:{format:'es'},
  build:{outDir:resolve(projectRoot,'out'),emptyOutDir:true},
  preview:{strictPort:true},
});
